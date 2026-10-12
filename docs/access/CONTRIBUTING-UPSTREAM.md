# Sending work back to the main project — leave docs/ out

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-11 ~17:50 Phoenix — `git remote -v` (`upstream` = phc4rdoso/vgc-planner), `gh repo view skymitch9/vgc-planner --json isFork,parent` (isFork true, parent phc4rdoso/vgc-planner), `gh repo set-default --view` (skymitch9/vgc-planner), `git fetch upstream` (upstream `main` = ffca430). NOT checked: the procedure below has never been run — no upstream PR has been opened; no cherry-pick tried.

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

## Repo shape — this repo IS a real GitHub fork (since 2026-10-10 18:55)

- `origin` = https://github.com/skymitch9/vgc-planner is a **GitHub fork of phc4rdoso/vgc-planner** (owner order: "Swap to real fork then delete clone repo"). The earlier standalone clone was renamed, replaced by the fork under the same name, and deleted. Verified: `fork=true parent=phc4rdoso/vgc-planner`, `main` = 4aa60bc on both sides before the delete; branches `feature/top-teams` and `feature/top-teams-data` pushed too.
- `upstream` = https://github.com/phc4rdoso/vgc-planner (identified 2026-10-10 18:2x; how: [UPSTREAM-PLAN.md](../info/UPSTREAM-PLAN.md)). Remote configured in this checkout.
- ⚠️ **Our `main` is NOT upstream's `main`.** Common base `7c75463`; upstream is 10 commits ahead of it as of 2026-10-11 (`git log --oneline main..upstream/main`), and our `main` carries all our feature and docs commits on top. Upstream PR branches are cut from `upstream/main`, never from our `main`.
- Because it is a real fork, an upstream PR is a branch pushed to `origin` and opened against `phc4rdoso/vgc-planner:main` (`gh pr create -R phc4rdoso/vgc-planner --head skymitch9:<branch>`). Opening one is outward-facing: **owner's go first**.
- ⚠️ **`gh` defaults to the PARENT on a fork.** `gh pr create` / `gh pr list` without a target can act on phc4rdoso's repo. `gh repo set-default skymitch9/vgc-planner` is set in this checkout; on any new clone set it again, and pass `-R skymitch9/vgc-planner` (or `--repo`) explicitly for PRs meant for our own repo.
- Lost in the swap, by design: the PR *pages* for the PRE-fork PR #1–#3 (Top builds, legal move targets, team feed; their commits and merge commits are intact in history). PR numbering in the fork restarted: today's #1–#4 are bulk import, saved team as opponent, move type colours, duplicate team.
