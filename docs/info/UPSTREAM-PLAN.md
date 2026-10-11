# Upstream plan — what to send back to phc4rdoso/vgc-planner, in what order, and how

> Audience: the owner, future Claude sessions, and (by way of the PR descriptions it drafts) the upstream maintainers. Status: TRACKED (fork-only; this file is never sent upstream, like everything under docs/). Last verified: 2026-10-10 — checked against git and GitHub: the upstream repo (`gh search repos`, `gh repo view`, its commit list and file tree via `gh api`), every commit hash and file list below (`git show --stat`, `gh pr view 1/2/3`), the imports that create the dependencies, the CSP lines, and `.dev.vars.example` on `main`. NOT checked: whether any cherry-pick applies cleanly to upstream `main` (no upstream remote was added, nothing was cherry-picked), `npm run check` on an upstream-based branch, and whether the maintainers want any of it.

Owner instruction (2026-10-10): *"I want to be able to commit as much of this back to the main code base as possible. lets make a plan for that after everything is working. save architecture questions for them."* Rule for every PR here: [access/CONTRIBUTING-UPSTREAM.md](../access/CONTRIBUTING-UPSTREAM.md) — no docs/ changes upstream, and the PR description says so.

## The upstream repository

| | |
|---|---|
| Repo | **https://github.com/phc4rdoso/vgc-planner** — "VGC Gameplan Planner: flowchart gameplans for Pokémon Champions with turn-by-turn damage (vgcplanner.app)", MIT, owner `phc4rdoso` (matches `LICENSE`: "Copyright (c) 2026 phc4rdoso") |
| Default branch | `main`, head `6dcd633` (2026-10-10 20:03 UTC) |
| Our base | `7c75463` "Merge branch 'docs/readme-demos'" — the last upstream commit in this repo. skymitch9/vgc-planner is a copy, not a GitHub fork (`isFork: false`), so GitHub will not offer "Contribute"; PRs go from a branch pushed to a real fork. |
| Upstream has moved | **8 commits ahead of `7c75463`, 0 behind** (`gh api .../compare/7c75463...main`): `f46e0fc` copy a turn; `ebd0ccb`, `d2017e1` keep a turn in view beside the editor; `299c54f`, `00537e3`, `5a4fdcc`, `43bdadd`, `6dcd633` the "What's new" news box (incl. server migration `0006_news_seen.sql`). They touch `src/ui/actions.ts`, `src/ui/events.ts`, `src/domain/model.ts`, `tests/codec.test.ts` — files our PRs also touch, so expect small conflicts. |
| Upstream PRs | none, open or closed (`gh pr list -R phc4rdoso/vgc-planner --state all` is empty) — ours would be the first. |

How it was found: `gh search repos vgc-planner` and `gh search repos "VGC Gameplan Planner"` both return `phc4rdoso/vgc-planner` (the only repo naming vgcplanner.app); `gh repo list phc4rdoso` lists it; its history contains our base `7c75463`. Confidence: high.

## ⚠️ Finding: PR #1 (Team builder + Top builds) is NOT upstream — it has to go first

[SPLIT-ARCHITECTURE.md](SPLIT-ARCHITECTURE.md) lists Top builds as "already upstream (PR #1)". That is wrong: PR #1 was merged into **skymitch9/vgc-planner** (`3d7f466`, commit `7148d22`), and upstream has no `src/data/`, no `src/domain/dex.ts`, no `src/infra/dex-loader.ts` (checked with `gh api .../contents`). Both later PRs import from it:

- PR #2: `src/ui/views/drawer.ts` imports `currentDex, loadDex` from `src/infra/dex-loader.ts` to read move target types from `src/data/champions-mc.json`.
- PR #3: `src/domain/team-feed.ts` imports `spreadLine, toID, type Dex` from `src/domain/dex.ts`; `fillSpreads` uses the usage data from `src/data/usage-mc.json`.

So the order is **PR 0 → A → B → C**, not A → B → C.

## What to send, in what order

| # | Upstream PR | Commits (cherry-pick in this order) | Size | Depends on |
|---|---|---|---|---|
| 0 | **Team builder with Reg M-C legality + Top builds** (our PR #1, merge `3d7f466`) | `7148d22` | 18 files, +1423 / −108 | — |
| A | **Turn editor offers only legal move targets** (our PR #2, merge `a438531`) | `4f0a469`, `c743061` | 5 files | PR 0 (dex loader + `champions-mc.json`) |
| B | **`Team.estimatedSpreads` + spread fill-in from usage** (domain half of our PR #3, merge `287604c`) | `26af519`, `0740c77` | 12 files | PR 0 (`dex.ts`, `usage-mc.json`) |
| C | **Team feed picker ("★ Top teams")** (infra/UI half of our PR #3) | `4c19d54`, `da4c6b9`, `a6357ee` | 13 files | B |

Non-docs changes since the base that are **not** in any upstream PR: `431b7be` (README link moved to `docs/info/ARCHITECTURE.md` — upstream keeps `docs/ARCHITECTURE.md`, so their link must stay; plus `package-lock.json` `"peer": true` churn from a different npm version), `45f9d46` (`eslint.config.js` ignores `.claude/` — harmless, upstream does track a `.claude/` folder, but send it only if their lint trips on it), `9fbf0e5` (`.dev.vars.example` YouTube key — see PR C). Full list: `git log --oneline 3d7f466..main -- ':!docs'` plus `7148d22`.

### Exact file lists (from the merged diffs)

**PR 0 — `7148d22`:** `README.md`, `e2e/smoke.mjs`, `package-lock.json`, `package.json`, `scripts/build-champions-data.mjs`, `scripts/fetch-usage.mjs`, `scripts/usage-reduce.mjs`, `src/data/champions-mc.json`, `src/data/usage-mc.json`, `src/domain/dex.ts`, `src/infra/dex-loader.ts`, `src/styles/builder.css`, `src/styles/index.css`, `src/ui/builder-html.ts`, `src/ui/picker.ts`, `src/ui/top-builds.ts`, `src/ui/views/team-view.ts`, `tests/dex.test.ts`.

**PR A — `4f0a469`:** `src/domain/simulation/targets.ts`, `tests/targets.test.ts`. **`c743061`:** `e2e/smoke.mjs`, `src/ui/events.ts`, `src/ui/views/drawer.ts`.

**PR B — `26af519`:** `src/domain/team-feed.ts`, `tests/fixtures/team-feed.json`, `tests/team-feed.test.ts`. **`0740c77`:** `src/domain/codec.ts`, `src/domain/model.ts`, `src/domain/team-feed.ts`, `src/domain/types.ts`, `src/infra/account-repository.ts`, `src/ui/actions.ts`, `src/ui/views/team-view.ts`, `tests/codec.test.ts`, `tests/team-feed.test.ts`.

**PR C — `4c19d54`:** `src/config.ts`, `src/infra/prefs.ts`, `src/infra/team-feed.ts`, `src/state/store.ts`, `src/types/env.d.ts`, `tests/repository.test.ts`, `tests/team-feed-loader.test.ts`. **`da4c6b9`:** `src/domain/model.ts`, `src/styles/builder.css`, `src/ui/actions.ts`, `src/ui/events.ts`, `src/ui/top-teams.ts`, `src/ui/views/team-view.ts`. **`a6357ee`:** `README.md`.

⚠️ **B/C is not a clean cut in our history.** `26af519` puts `readFeed` / `resolvePaste` (feed parsing) in `src/domain/team-feed.ts` next to `fillSpreads`, and `fillSpreads` is only called from `src/ui/top-teams.ts` (C). A standalone B therefore needs two hand edits on the upstream branch, said so in the PR: (1) move `fillSpreads` (+ `stillEstimated`) into its own module (e.g. `src/domain/spread-fill.ts`), leaving the feed parsing for C; (2) give it a caller — the natural one is filling missing spreads (labelled Estimated) when a paste without `EVs:` lines is loaded through the existing paste box / link loader. If that is too much rework, send B and C as one PR after the conversation C needs anyway.

## What the maintainers may push back on, and the suggested answer

**PR 0 — Team builder + Top builds**
- *Two generated JSON files committed to `src/data/`.* Answer: regenerated by `npm run champions-data` / `npm run usage` from Showdown's own validator and Smogon's public usage stats; committing them keeps the build offline and deterministic. They already load lazily through `src/infra/dex-loader.ts`.
- *`package-lock.json` changes.* Answer: regenerate the lock on the upstream branch with their npm version rather than sending ours.
- *Reg M-C hard-coded.* Answer: `FORMAT` in `scripts/build-champions-data.mjs` is the one switch, documented in the README.

**PR A — legal move targets** (small and uncontroversial once PR 0 is in)
- *Why read target types from `champions-mc.json`, not the calculator?* Answer: `@smogon/calc` only knows spread target types and reports the rest as `any`; the simulation only branches on spread types, so it is unaffected; unknown types stay permissive.
- *Existing saved plans with now-illegal targets.* Answer: nothing is migrated or deleted; a saved illegal target shows once flagged "(not a legal target)" until replaced, and saving a new illegal value is refused with a toast.
- *Smoke test change.* Answer: `e2e/smoke.mjs` used to set Earthquake to "Both foes", now impossible; it asserts "All". Say honestly that the smoke test's later turn-result step times out on unmodified code too (our KI-1).

**PR B — `Team.estimatedSpreads` + fill-in**
- *Data-model change on a synced type.* Answer: optional and bounded in the codec, older data loads unchanged, the account record carries it only when non-empty, cleared on a hand edit of that Pokémon's spread or a hand-replaced paste. No D1 migration (it rides inside the team JSON) — ask them to confirm their server stores the team opaquely; we only unit-tested sync against the in-memory store.
- *Is an estimated spread misleading?* Answer: every filled spread carries a visible "Estimated spread" chip; spreads from the paste are never overwritten.

**PR C — team feed picker** (needs a conversation first: open an issue before the PR)
- *A new preference (`teamFeedUrl`) and a new UI surface.* Answer: the production default is empty, so nothing is fetched until a user enters a feed URL. If they prefer, drop the preference and use the build-time `config.teamFeed.defaultUrl` only. See question 3 below.
- *CSP `connect-src`.* `public/_headers` and `deploy/security-headers.inc` allow only `'self'`, cloudflareinsights.com, pokepast.es, vrpaste-backend.vercel.app and replay.pokemonshowdown.com, so on vgcplanner.app **any** feed origin is blocked (our KI-2). Answer: they add the one origin they choose to trust, or the feature is dev-only until they do. Never `connect-src *`.
- *The feed format becomes a public contract.* Answer: it is small (`format`, `generated`, `entries[]` with `paste` and a `spreads` flag; shape in the README section from `a6357ee` and [SPLIT-ARCHITECTURE.md](SPLIT-ARCHITECTURE.md)) and validated like untrusted data (bounded counts, capped strings, whitelisted tiers, same-origin pastes only, malformed entries skipped). Offer a `version` field before it goes public.
- *`.dev.vars.example` `YOUTUBE_API_KEY`.* **Still on `main` as of 2026-10-10** (added by `9fbf0e5`, a docs commit). It is App 2's business; the planner never reads it. It is in none of the commits above, so cherry-picking keeps it out — do not add it upstream. Removing it from this fork's `main` too is a separate one-line cleanup for the owner to decide.
- *Who runs the feed?* Answer: the planner only consumes a static JSON + pastes; the aggregation is a separate repo and not part of the PR (question 1).

## Mechanics

1. One-time: `git remote add upstream https://github.com/phc4rdoso/vgc-planner.git && git fetch upstream`. Create a real GitHub fork to push PR branches to (e.g. `gh repo fork phc4rdoso/vgc-planner --remote-name ghfork --clone=false`), since skymitch9/vgc-planner is not a fork. **Owner's call** — it creates a public repo under his account.
2. Per PR: `git checkout -b upstream/<topic> upstream/main`, then `git cherry-pick <commits from the table, in order>`. Resolve conflicts against upstream's newer `actions.ts` / `events.ts` / `model.ts` / `codec.test.ts`: keep their behaviour, add ours.
3. docs/: none of the commits above touch `docs/`, so a branch built from `upstream/main` carries none of ours. ⚠️ Do **not** run the `git rm -r --cached docs` step from [CONTRIBUTING-UPSTREAM.md](../access/CONTRIBUTING-UPSTREAM.md) on a branch based on `upstream/main` — upstream has its own `docs/ARCHITECTURE.md` and `docs/media/` (the README demos), and that step would delete them in the PR. That doc's check still applies unchanged: `git diff --stat upstream/main...HEAD -- docs` must print nothing. Its PR-description line and explicit-staging rule apply as written.
4. `npm ci && npm run check` (typecheck + lint + tests) on the branch; also `npm run build` for PR 0 and C.
5. Push to the fork and open the PR against `phc4rdoso/vgc-planner:main`, one at a time — wait for PR 0's review before opening A.

### PR description template

```markdown
## What
<one paragraph: the user-visible change>

- `<file>`: <what it does>

## Why
<the problem, one or two sentences>

## Verified
- `npm run check`: typecheck + lint clean, <N> tests pass (branch based on upstream main <sha>).
- <browser checks, if any>

## Not verified
- <specific>

docs/ is intentionally excluded from this PR; it lives only in skymitch9/vgc-planner.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<session link of the session that opens the PR>
```

Cherry-picked commits keep their `Co-Authored-By: Claude …` trailers (upstream's own commits carry the same kind of trailer).

## Architecture questions to save for the maintainers (owner instruction: ask, do not decide)

1. **A separate aggregation app + API + DB.** We run tournament / YouTube / Smogon aggregation as its own repo (vgc-meta: SQLite, CLI, publishes a static `feed.json` + pastes). Would they want the planner to talk to such a service through an API, keep consuming static files, or depend on none at all?
2. **Does a team feed belong in the product?** Or should "load a team" stay pastes + pokepast.es / VR Pastes links, with feeds left to third-party sites that link to pastes?
3. **Where a feed URL lives:** a user preference (what PR C does), a build-time constant they control, or a short curated allow-list (which also settles the CSP question).
4. **Showdown-based simulation outside the planner.** Our full-battle simulator (Pokémon Showdown's engine with its Champions mod, Monte Carlo over leads) lives in vgc-meta and outputs pokepastes; the planner's engine (`src/domain/simulation/`) stays the planned-turn calculator. Would they want sim results surfaced in the planner (e.g. importing a report), or keep the two apart?
5. **The news box** (`src/domain/news.ts`, upstream since `5a4fdcc`): do they want an entry per accepted feature, and written by whom?

## Not upstream material at all

| What | Why it stays here |
|---|---|
| `docs/` (all of it) | Owner rule 2026-10-10; fork-only operating docs. |
| The vgc-meta repo (`..\vgc-meta`) | App 2: scrapers, SQLite, simulator, feed publisher. Its own project. |
| Branches `feature/top-teams`, `feature/top-teams-data` | The in-repo aggregation pipeline (`scripts/fetch-teams.mjs`, source parsers, `src/data/teams-mc.json`, usage cores). Superseded by vgc-meta; kept in this repo as history. |
| `9fbf0e5` `.dev.vars.example` `YOUTUBE_API_KEY` | App 2's secret; the planner never reads it. |
| `431b7be` README link + lockfile churn | Follows our docs move, not theirs. |
| A production feed origin in the CSP (KI-2) | Only meaningful once a public feed exists and they agree to trust it. |
