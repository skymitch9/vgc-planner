# Recovery: rebuilding the planner (App 1) from nothing but git

> Audience: anyone rebuilding this checkout cold, including a weaker executor. Status: TRACKED. Last verified: 2026-10-11 ~17:50 Phoenix — measured: remotes (`git remote -v`), `gh repo view skymitch9/vgc-planner --json isFork,parent` (fork of phc4rdoso/vgc-planner, PUBLIC), `gh repo set-default --view` (skymitch9/vgc-planner), script names in `package.json`, `wrangler.toml`, `.dev.vars.example`, which `.dev.vars` NAMES are filled (values not read), `server/migrations/` (0001–0005), `.gitignore`, the absence of `dist/`, `.wrangler/` and `deploys.log`, Node v24.11.1 against `engines` ≥ 22.12. NOT checked: a fresh clone on another machine (never drilled), `npm ci` (this checkout used `npm install`), any wrangler / Cloudflare command (none run), whether the owner's Cloudflare account can deploy at all.

Each step is marked **DRILLED** (actually done in this checkout) or **INFERRED** (read from the repo, never run here).

## ⚠️ GAP — the owner's planner library exists only in his browser

The owner's teams and gameplans live in **browser `localStorage` on this machine** and nowhere else. No account sign-in is configured for this checkout (the Discord / Google client names in `.dev.vars` are empty, the local API `npm run dev:api` is not running, and `.wrangler/` — the local D1 database — does not exist), so nothing syncs to a server. Git does not hold it. Clearing site data, a different browser profile, or a stale second tab (KNOWN_ISSUES KI-4) loses it.

**Mitigation (owner action, no code):** in the planner sidebar press **Export all** → the **Export JSON** dialog → save the file somewhere backed up (OneDrive / 1Password document). Restore = sidebar **Import** → tab **Backup file (JSON)** → choose the file (merges by team name). Do this after any session that changes teams. Not drilled as a restore in this checkout; the import path is unit-tested by the codec tests.

## 1 · Code

| Step | Command | Status |
|---|---|---|
| Clone our fork | `git clone https://github.com/skymitch9/vgc-planner.git && cd vgc-planner` | INFERRED (this checkout was a clone of the pre-fork repo; the fork swap kept the same URL) |
| Add the parent as `upstream` | `git remote add upstream https://github.com/phc4rdoso/vgc-planner.git && git fetch upstream` | DRILLED (remote exists; fetched 2026-10-11) |
| ⚠️ Pin `gh` to OUR repo | `gh repo set-default skymitch9/vgc-planner` — on a fork `gh` otherwise defaults to the parent. Still pass `-R skymitch9/vgc-planner` on every `gh pr …` | DRILLED |
| Branches | Only `main` matters. `feature/top-teams`, `feature/top-teams-data` are history (the pipeline moved to vgc-meta) | — |

Upstream's `main` is NOT our `main` (see [CONTRIBUTING-UPSTREAM.md](CONTRIBUTING-UPSTREAM.md)).

## 2 · Dependencies

| Step | Command | Status |
|---|---|---|
| Node ≥ 22.12 (`engines`); this machine runs v24.11.1 via nvm4w | `node --version` | DRILLED |
| Install | `npm ci` (exact lockfile) — this checkout used `npm install` | INFERRED for `npm ci`; `npm install` DRILLED (2026-10-11 01:04, after KI-3) |
| Verify | `npm run check` (typecheck + lint + unit tests; 239 tests on `main` at 31a9cbf as reported 2026-10-11 13:25) | DRILLED (on 2026-10-11 by the conductor; not re-run in this docs pass) |

⚠️ Never link a worktree's `node_modules` to this tree, and never `rm -rf` a worktree (KI-3).

## 3 · Generated data

| Data | Command | In git? | Status |
|---|---|---|---|
| Sprites → `public/sprites/` (~3,000 files, ~50 MB, sparse clone of robsonbittencourt/vgc-multicalc; Nintendo artwork, so gitignored) | `npm run sprites` (bash script) | NO — regenerate per checkout | DRILLED 2026-10-11 01:32 |
| Legality data `src/data/champions-mc.json` | `npm run champions-data [path/to/pokemon-showdown]` | yes (committed) | INFERRED — only needed for a new regulation |
| Top builds usage `src/data/usage-mc.json` | `npm run usage [YYYY-MM] [rating]` | yes (committed) | INFERRED |
| Move effects / avatars | `npm run move-effects`, `npm run avatars` | yes (committed) | INFERRED |

## 4 · Run locally (machine state)

| Thing | Command | Status |
|---|---|---|
| Planner dev server, http://localhost:5173 | `npm run dev` (Vite) | DRILLED (running since 2026-10-10 16:25) |
| `.dev.vars` (gitignored) | `cp .dev.vars.example .dev.vars`, then fill from 1Password (see secrets below) | DRILLED (exists; `APP_URL`, `DEV_LOGIN`, `YOUTUBE_API_KEY` filled; the four OAuth names empty) |
| Local API + D1 (accounts), :8787 | `npm run db:migrate:local` once, then `npm run dev:api` | INFERRED — never run in this checkout (no `.wrangler/`) |
| The team feed the ★ Top teams picker reads (dev default `http://localhost:4400/feed.json`) | comes from App 2: in `../vgc-meta`, `npx serve@14.2.4 public -l 4400 --cors`; rebuilding vgc-meta is [its own RECOVERY.md](../../../vgc-meta/docs/access/RECOVERY.md) | DRILLED (answering 2026-10-11 17:47) |

## 5 · Cloudflare Worker + D1 (production)

From `wrangler.toml` and the top-level README "Deploy to Cloudflare":

| Item | Value (from the repo) |
|---|---|
| Worker name | `vgc-gameplan-planner`, entry `server/src/index.ts`, static assets `./dist` |
| Route | `vgcplanner.app` (custom domain), `workers_dev = false` |
| D1 binding / database | `DB` → `vgc-gameplans`, migrations in `server/migrations/` (0001_auth … 0005_custom_name) |
| Deploy | `npx wrangler login` → `npx wrangler d1 migrations apply vgc-gameplans --remote` → `npm run sprites` → `npm run deploy` (checks sprites, builds, `wrangler deploy`) |
| Secrets | `npx wrangler secret put DISCORD_CLIENT_ID` (and `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); never `DEV_LOGIN` in production |

⚠️ **This config is UPSTREAM's production, not ours.** `vgcplanner.app` and the `database_id` in `wrangler.toml` are inherited from phc4rdoso/vgc-planner. A deploy from this fork needs the owner's own Cloudflare account, a new D1 database (`wrangler d1 create`), a new `database_id`, and a different route — an owner decision, not a recovery step.

**Has this fork ever been deployed from this machine? Not verified; no `deploys.log` exists**, there is no `dist/` and no `.wrangler/` in this checkout, and no deploy is recorded in docs. Treat the answer as "no" until shown otherwise. All of section 5 is INFERRED.

## 6 · Secrets (names only; custody in [SECRETS.md](SECRETS.md))

`YOUTUBE_API_KEY` (App 2's harvester; 1Password vault **VGC Planner**), `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (not minted for this checkout). `.dev.vars.example` is the authority on which names exist. No secret is needed to run the planner locally without accounts.

## Rebuild order, short

```bash
git clone https://github.com/skymitch9/vgc-planner.git && cd vgc-planner
git remote add upstream https://github.com/phc4rdoso/vgc-planner.git && git fetch upstream
gh repo set-default skymitch9/vgc-planner
npm ci && npm run check
npm run sprites
cp .dev.vars.example .dev.vars        # fill names from 1Password vault "VGC Planner" (op read), never via chat
npm run dev                           # http://localhost:5173
# then Import -> Backup file (JSON) with the owner's latest Export all file
```
