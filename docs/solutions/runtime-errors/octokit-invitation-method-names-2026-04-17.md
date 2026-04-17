---
title: Hallucinated Octokit Method Names and Nullability Drift in Handwritten Interfaces
category: runtime-errors
problem_type: runtime_error
component: tooling
root_cause: wrong_api
resolution_type: code_fix
severity: high
date: 2026-04-17
last_updated: 2026-04-17
module: scripts/handle-invitation.ts
tags: [octokit, github-api, invitation-api, runtime-error, ai-hallucination, type-safety, handwritten-interface]
verified: true
---

## Problem

The scheduled `Poll invitations` workflow failed at runtime because `octokit.rest.users.listRepositoryInvitations` and `octokit.rest.users.acceptInvitation` don't exist in `@octokit/rest`.

## Symptoms

- Scheduled `poll-invitations.yaml` workflow fails with exit code 1
- Error: `InvitationHandlingError: GitHub API error while polling invitations: octokit.rest.users.listRepositoryInvitations is not a function`
- Stacktrace points to `normalizePollingError` in `handle-invitation.ts:368`
- All tests pass locally because tests use mock interfaces, not real Octokit

## What Didn't Work

- The custom `OctokitClient` interface declared methods under `rest.users` — TypeScript was satisfied because the interface was hand-written, not imported from `@octokit/rest`
- The names looked correct: `listRepositoryInvitations` mirrors the REST endpoint `GET /user/repository_invitations`, and `acceptInvitation` mirrors `PUT /user/repository_invitations/{id}`
- Tests used mocks implementing the wrong interface, so they passed

## Solution

Move invitation methods from `users` to `repos` namespace and rename to match the actual `@octokit/rest` surface:

```typescript
// BEFORE (broken) — methods don't exist
octokit.rest.users.listRepositoryInvitations()
octokit.rest.users.acceptInvitation({ invitation_id })

// AFTER (correct)
octokit.rest.repos.listInvitationsForAuthenticatedUser()
octokit.rest.repos.acceptInvitationForAuthenticatedUser({ invitation_id })
```

The `OctokitClient` interface, implementation calls, and all test mocks were updated to match.

**Discovery method** — introspect the real Octokit instance at runtime:

```typescript
node -e "
import('@octokit/rest').then(m => {
  const o = new m.Octokit({ auth: 'fake' });
  for (const [ns, methods] of Object.entries(o.rest)) {
    const matches = Object.keys(methods).filter(k =>
      k.toLowerCase().includes('invit')
    );
    if (matches.length > 0) console.log(ns + ':', matches);
  }
});
"
// Output: repos: [ 'acceptInvitationForAuthenticatedUser', ... , 'listInvitationsForAuthenticatedUser', ... ]
```

## Why This Works

`@octokit/rest` generates method names from the GitHub OpenAPI spec, not from REST endpoint paths. The API has `GET /user/repository_invitations` but Octokit maps it to `repos.listInvitationsForAuthenticatedUser` because the OpenAPI spec tags it under "repos" — the invitation is for a repository, even though the endpoint lives under `/user/`.

## Prevention

1. **Never trust AI-generated SDK method names.** Verify against the actual SDK at runtime using introspection or official docs. This bug originated from an AI subagent hallucinating plausible-but-wrong method names.

2. **Add a runtime smoke test** that asserts expected methods exist on the real Octokit:

   ```typescript
   it('OctokitClient interface methods exist on real Octokit', async () => {
     const { Octokit } = await import('@octokit/rest')
     const o = new Octokit({ auth: 'fake' })
     expect(typeof o.rest.repos.listInvitationsForAuthenticatedUser).toBe('function')
     expect(typeof o.rest.repos.acceptInvitationForAuthenticatedUser).toBe('function')
   })
   ```

3. **Custom OctokitClient interfaces mask real API mismatches.** When you write your own interface subset instead of importing from `@octokit/rest`, TypeScript can only check against what you declared. Consider a one-time validation step that checks the real instance has all declared methods.

4. **For subagent-generated code**, treat SDK method names as claims to verify before merging — especially when the project uses custom type interfaces that can't catch naming errors.

## Second Occurrence (2026-04-17) — `starRepo` and Nullable Inviter

Same class of bug, different method. The next scheduled `Poll invitations` run (after PR #3083 merged) failed at runtime with:

```
params.octokit.rest.activity.starRepo is not a function
```

[Failed run](https://github.com/fro-bot/.github/actions/runs/24560380936/job/71807245854). `octokit.rest.activity.starRepo` does not exist on `@octokit/rest` — the correct method is `starRepoForAuthenticatedUser`. Same discovery method, same fix shape:

```typescript
// BEFORE (broken)
await params.octokit.rest.activity.starRepo({owner, repo})

// AFTER (correct)
await params.octokit.rest.activity.starRepoForAuthenticatedUser({owner, repo})
```

The handwritten `OctokitClient` interface declared `starRepo` on the `activity` namespace, so `tsc` was satisfied. Real `@octokit/rest` only exposes the `ForAuthenticatedUser` variant.

### Audit Triggered by the Second Hit

After two occurrences in the same file, an Oracle audit verified every `octokit.rest.X.Y(...)` call site across all scripts against the real generated types in `node_modules/@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types.d.ts`. 22 of 23 call sites were clean; one additional latent risk surfaced:

### Nullability Drift — Handwritten Interfaces Also Lie About Null

The same `OctokitClient` interface declared:

```typescript
interface RepositoryInvitation {
  id: number
  inviter: { login: string }  // never-null
  repository: { name: string; owner: { login: string } }
}
```

GitHub's real schema types `inviter` as `nullable-simple-user` — it is `null` when the inviting user's account has been deleted. Unguarded `invitation.inviter.login` access would throw.

Fix:

```typescript
export interface RepositoryInvitation {
  id: number
  /**
   * GitHub's schema types inviter as `nullable-simple-user` — it can be `null` when the inviting
   * user account has been deleted. Always guard before dereferencing `inviter.login`.
   */
  inviter: { login: string } | null
  repository: { name: string; owner: { login: string } }
}

// Guard in processInvitation — skip with reason rather than throw
const inviter = params.invitation.inviter?.login ?? null
if (inviter === null) {
  return {
    invitationId: params.invitation.id,
    inviter: null,
    owner: repoOwner,
    repo: repoName,
    status: 'skipped',
    reason: 'inviter-unknown',
  }
}
```

**Lesson:** handwritten SDK interfaces don't just hallucinate method existence — they also silently tighten nullability, dropping `null` variants that the real schema declares. The compiler faithfully enforces the lie.

## Prevention Update — Derive Interfaces from Real SDK Types

The four prevention rules above still apply. Add a fifth, stronger rule:

5. **Replace handwritten SDK interfaces with derived types.** `@octokit/rest` exposes types that can be narrowed at the call site without reimplementing them:

   ```typescript
   import type { Octokit } from '@octokit/rest'

   type OctokitRest = InstanceType<typeof Octokit>['rest']

   // Narrow to just the namespaces you use — hallucinated method names and
   // tightened nullability both become compile errors.
   export type InvitationsClient = {
     rest: Pick<OctokitRest, 'repos' | 'activity' | 'actions'>
   }
   ```

   This preserves the "narrow client" ergonomics (you don't drag the full Octokit type through every module) while making the SDK surface the single source of truth. Neither hallucinated methods nor dropped `null`s survive `tsc`.

6. **After the first hallucinated-method hit, audit every SDK call site in the repo.** The first bug is usually a signal of a class, not an isolated one. Targets of the audit: grep for `octokit.rest.*.*(` and verify each method exists in `node_modules/@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types.d.ts`. Also flag any handwritten types whose nullability looks narrower than the real schema (a spot-check of 2–3 endpoints' generated parameter/response types usually surfaces these).

## References

### First occurrence (PR #3083)

- Failed run: https://github.com/fro-bot/.github/actions/runs/24552752433/job/71781983720
- Fix PR: https://github.com/fro-bot/.github/pull/3083

### Second occurrence (PR #3087)

- Failed run: https://github.com/fro-bot/.github/actions/runs/24560380936/job/71807245854
- Fix PR: https://github.com/fro-bot/.github/pull/3087

### External

- GitHub REST API docs: https://docs.github.com/en/rest/collaborators/invitations
- `@octokit/rest` generated method types: `node_modules/@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types.d.ts`
