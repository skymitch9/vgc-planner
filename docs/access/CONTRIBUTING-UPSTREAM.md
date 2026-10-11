# Sending work back to the main project — leave docs/ out

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-10 (owner instruction; no upstream remote is configured yet, see below).

**Owner rule (2026-10-10), verbatim:** "we can post the docs to our github but make a note that when we do the fork pr back to the main we leave a note to exclude docs in the commit."

| Where | docs/ allowed? |
|---|---|
| This repo, `origin` = https://github.com/skymitch9/vgc-planner (all branches, PRs within it) | Yes — docs/ is tracked and pushed here |
| A PR from this repo back to the main / upstream project | **No** — the PR must not add, change or delete anything under `docs/`, and the PR description must say so |

## How to open an upstream PR without docs/

⚠️ **Corrected 2026-10-10 18:2x.** The earlier version said `git rm -r --cached docs`; that would DELETE upstream's own `docs/ARCHITECTURE.md` and `docs/media/` in the PR. Never do that. The right shape:

1. Branch from upstream's default branch and cherry-pick only the code commits:
   ```bash
   git fetch upstream                      # upstream = https://github.com/phc4rdoso/vgc-planner.git
   git checkout -b upstream/<topic> upstream/main
   git cherry-pick <commit>...             # the commits listed per PR in docs/info/UPSTREAM-PLAN.md; none touch docs/
   git diff --stat upstream/main...HEAD -- docs   # MUST print nothing
   npm run check
   ```
2. Put this line in the PR description: *"docs/ is intentionally excluded from this PR; it lives only in skymitch9/vgc-planner."*
3. Never `git add -A` on an upstream branch; stage explicit paths.

## Not verified / open

- Upstream identified 2026-10-10 18:2x: **https://github.com/phc4rdoso/vgc-planner** (default branch main, head 6dcd633, 8 commits ahead of our base 7c75463); the `upstream` remote is now configured locally. skymitch9/vgc-planner is still not a GitHub fork, so PR branches need a real fork or a direct push — the owner's call (see UPSTREAM-PLAN.md).

## Repo shape since 2026-10-10 18:55 — this repo IS a real fork now

- `origin` = https://github.com/skymitch9/vgc-planner is a **GitHub fork of phc4rdoso/vgc-planner** (owner order: "Swap to real fork then delete clone repo"). The earlier standalone clone was renamed, replaced by the fork under the same name, and deleted. Verified: `fork=true parent=phc4rdoso/vgc-planner`, `main` = 4aa60bc on both sides before the delete; branches `feature/top-teams` and `feature/top-teams-data` pushed too.
- ⚠️ **Our `main` is NOT upstream's `main`.** It carries 30 commits of ours (docs/ included) and lacks 8 of theirs. Upstream PR branches are still cut from `upstream/main`, never from our `main`.
- ⚠️ **`gh` defaults to the PARENT on a fork.** `gh pr create` / `gh pr list` without a target can act on phc4rdoso's repo. `gh repo set-default skymitch9/vgc-planner` is set in this checkout; on any new clone set it again, and pass `-R skymitch9/vgc-planner` (or `--repo`) explicitly for PRs meant for our own repo.
- Lost in the swap, by design: the PR *pages* for our PR #1–#3 (the commits and merge commits are intact in history). PR numbering in the fork restarts.
