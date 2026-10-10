# Sending work back to the main project — leave docs/ out

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-10 (owner instruction; no upstream remote is configured yet, see below).

**Owner rule (2026-10-10), verbatim:** "we can post the docs to our github but make a note that when we do the fork pr back to the main we leave a note to exclude docs in the commit."

| Where | docs/ allowed? |
|---|---|
| This repo, `origin` = https://github.com/skymitch9/vgc-planner (all branches, PRs within it) | Yes — docs/ is tracked and pushed here |
| A PR from this repo back to the main / upstream project | **No** — the PR must not add, change or delete anything under `docs/`, and the PR description must say so |

## How to open an upstream PR without docs/

1. Branch from the commit you want to send, then drop docs/ from that branch only:
   ```bash
   git checkout -b upstream/<topic> <branch-to-send>
   git rm -r --cached docs && git commit -m "Exclude docs/ from the upstream PR (kept in skymitch9/vgc-planner only)"
   ```
   The test that matters: `git diff --stat <upstream>/main...HEAD -- docs` must print nothing.
2. Put this line in the PR description: *"docs/ is intentionally excluded from this PR; it lives only in skymitch9/vgc-planner."*
3. Never `git add -A` on an upstream branch; stage explicit paths.

## Not verified / open

- As of 2026-10-10 `gh repo view` reports skymitch9/vgc-planner is **not a GitHub fork** and no `upstream` remote exists, so the main project's URL is unknown to this doc. Add it here when the first upstream PR is opened.
