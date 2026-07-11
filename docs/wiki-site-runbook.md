# Wiki Site Runbook: Emergency Takedown

Operator runbook for pulling the public wiki site ([fro-bot.github.io/.github](https://fro-bot.github.io/.github/)) offline fast. This is an incident-response path, not something that runs on a schedule.

## When to Use It

Something on a rendered wiki page shouldn't be public — a mis-scoped survey, a bad promotion, anything that needs to stop being served right now, before you have time to fix the underlying data.

## Takedown Procedure

1. Go to **Actions → Unpublish Wiki (emergency takedown)**.
2. Run the workflow via manual dispatch.
3. It deploys the static `takedown/` site as a full, atomic Pages artifact swap — the live site is replaced outright, not patched.

The job runs under the `pages-emergency` environment, which has **no required reviewers**. That's intentional: gating an incident-response takedown behind an approval step defeats the point.

### If Actions Is Broken

Manual fallback, no workflow required:

1. Repo **Settings → Pages**.
2. Unpublish the site directly from there.

## Restoring the Site

A normal **Publish Wiki** run restores the real content — no special "undo takedown" step. Push to `main` touching wiki content (or dispatch it manually) and the rebuild replaces the takedown page.

## One-Time Environment Setup

Two GitHub Environments gate deploys, and they're configured deliberately differently:

- **`github-pages`** — used by normal publishes. Branch policy restricted to `main` only. Optionally add a required reviewer here as a publish gate if you want a human in the loop before routine content goes live.
- **`pages-emergency`** — used only by the takedown workflow. **No required reviewers, no branch restriction beyond what the workflow itself enforces.** A takedown that needs approval before it can run isn't a takedown.

Get this backwards — required reviewers on `pages-emergency`, none on `github-pages` — and you've built the opposite of what an incident response needs.

## Honest Residuals

A takedown is not a memory hole. After the swap:

- **GitHub Pages edge cache**: content already cached at `*.github.io` edges takes roughly 10 minutes to fully expire.
- **Search engines and the Wayback Machine**: anything already indexed or archived is out of your control. No takedown workflow retracts a Google cache entry or a Wayback snapshot.

If the exposure is serious enough to need a takedown, treat the content as having been public and cached the moment it was live — the workflow stops new requests from seeing it, it doesn't erase what already happened.
