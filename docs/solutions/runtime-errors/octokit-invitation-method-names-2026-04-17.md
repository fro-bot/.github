---
title: Incorrect Octokit Invitation API Method Names
problem_type: runtime_error
component: tooling
root_cause: wrong_api
resolution_type: code_fix
severity: high
date: 2026-04-17
module: scripts/handle-invitation.ts
tags: [octokit, github-api, invitation-api, runtime-error, ai-hallucination]
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

## References

- Failed run: https://github.com/fro-bot/.github/actions/runs/24552752433/job/71781983720
- Fix PR: https://github.com/fro-bot/.github/pull/3083
- GitHub REST API docs: https://docs.github.com/en/rest/collaborators/invitations
