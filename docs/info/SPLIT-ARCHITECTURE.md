# The split: App 1 (this fork) and App 2 (meta + simulation), joined by pokepastes

> Audience: the owner and future Claude sessions. Status: TRACKED (fork-only docs; never sent upstream). Last verified: 2026-10-11 ~17:50 Phoenix — the "What was built" box and the status column were checked against `git log` (commits named exist on `main`), `gh pr list -R skymitch9/vgc-planner --state merged`, `curl http://localhost:4400/feed.json` (top-level keys `format, generated, sources, library, entries`; 1,372 entries) and vgc-meta's `docs/info/SIMULATION.md` (engine pin). The design text below is kept as the 2026-10-10 record. NOT checked: vgc-meta's code itself (read its docs only), the feed in a production build (KI-2).

**Owner decision, 2026-10-10, verbatim:** *"the one thing i want to add to this fork is the api for loading in the top spreads for pokemon … everything else I want as a new app that outputs as a pokepaste and we use those pokepaste as the go between … this include the simulation app i want to build, that'll be in app 2."*

> **What was built (2026-10-11).** Both halves exist.
> - **App 1 (this fork):** the feed picker + Estimated/Confirmed spread fill-in are BUILT (pre-fork PR #3, merge `287604c`: `26af519`, `0740c77` fill-in; `4c19d54`, `da4c6b9`, `a6357ee` picker). The in-repo aggregation pipeline did leave (branches `feature/top-teams*` kept as history). Later fork features (bulk import, saved team as opponent, move type colours, duplicate team) are listed in [UPSTREAM-PLAN.md](UPSTREAM-PLAN.md).
> - **App 2 = `vgc-meta`**, PRIVATE repo https://github.com/skymitch9/vgc-meta (PRs #1–#11 merged, `main` b3ecba2): sources (Limitless, crob.at, Victory Road, YouTube ×18 channels, VGCPastes sheet, real results + Showdown replays), SQLite store, set library, publisher, simulator (player with 16 toggleable features, all on by default since 2026-10-11 13:10), matrix / tiers / improve / calibrate / agree, team builder, coach (local server + browser extension). Its feed is served LOCALLY on http://localhost:4400/feed.json (no public home yet; KI-2). Its own docs are the authority for everything App 2.
> - **The feed grew** beyond the format sketched below: it now also carries top-level `sources` (per-source fetched time and counts) and `library` (set-library totals). The App 1 codec ignores fields it does not know (as designed).
> - **Not built from this design:** the nightly GitHub Actions refresh (blocked by owner rule: no Actions on a private repo; vgc-meta is private), Cloudflare Pages hosting for the feed, mirroring pastes to pokepast.es.

## The one-line contract

**App 2 produces pokepastes. App 1 consumes pokepastes.** Nothing else crosses the line. A pokepaste is already the lingua franca of VGC (pokepast.es, VR Pastes, Showdown import), App 1 already loads them from a link, and upstream has no reason to object to more of that.

```
 Limitless · crob.at · Victory Road · YouTube · (X later)      Smogon usage (chaos)
            │                                                          │
            ▼                                                          ▼
 ┌──────────────────────── App 2: vgc-meta (new repo) ─────────────────────────┐
 │ scrapers → SQLite (teams, sets, spreads+provenance, replica codes, sources) │
 │ simulation engine (my team × meta teams, parallel; leads, odds, win rates) │
 │ OUTPUT: pokepastes  +  feed.json (index with metadata)  +  sim reports     │
 └──────────────────────────────────┬──────────────────────────────────────────┘
                                    │  https://<host>/feed.json, /pastes/<id>.txt
                                    ▼
 ┌──────────────────── App 1: vgc-planner (this fork → upstream) ──────────────┐
 │ "Load a team": paste text, a pokepast.es / vrpastes link, OR a feed entry   │
 │ + fill-in of missing Stat Point spreads from Smogon's top spread, labelled  │
 │ ESTIMATED (confirmed ones stay as the paste says)                           │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## App 1 — what stays in the fork (small, generic, upstream-shaped)

| Piece | Status | Upstream-friendly because |
|---|---|---|
| Load a team from a pokepaste / VR Pastes **link** everywhere a paste box exists | already upstream (verified 2026-10-10: in phc4rdoso/vgc-planner history before our base 7c75463) | — |
| **Team feed**: a configurable list of feed URLs; the "★ Top teams" picker lists the feed's entries (player, event, date, confirmed/estimated flag, replica codes, source link) and loads the chosen paste through the existing link loader, wherever a paste can be loaded | BUILT 2026-10-10 (pre-fork PR #3; commits `4c19d54`, `da4c6b9`, `a6357ee`); dev default feed `http://localhost:4400/feed.json`, production default empty | a generic "import from a feed" feature with a tiny public JSON format; no scraping, no 840 KB data file, no secrets in the planner |
| **Top spreads fill-in**: when a loaded set has no Stat Points, use Smogon's most used spread for that Pokémon and label it *Estimated*; keep the player's spread and label it *Confirmed* when the paste has one | BUILT 2026-10-10 (pre-fork PR #3; commits `26af519`, `0740c77`: `Team.estimatedSpreads`, `fillSpreads`, "Estimated spread" chips) | reuses the usage data the project already ships for Top builds |
| Top builds (per-Pokémon usage: items, moves, spreads) | in THIS repo only (our PR #1, 7148d22) — ⚠️ NOT upstream; corrected 2026-10-10 18:2x after the upstream plan checked phc4rdoso/vgc-planner, which has no src/data, dex.ts or dex-loader | it is the base PR A/B/C depend on; see [UPSTREAM-PLAN.md](UPSTREAM-PLAN.md) |

What LEAVES the fork (moves to App 2, nothing lost — it is all on branches): `scripts/fetch-teams.mjs` + the four source parsers + `src/data/teams-mc.json` + the derived "usage cores" (`src/domain/top-teams.ts`) + the real-teams picker tab. The branches `feature/top-teams` and `feature/top-teams-data` are the seed of App 2's repo.

## The feed format (the only thing both apps must agree on)

```jsonc
// https://<host>/feed.json  — regenerated by App 2 on every refresh
{
  "format": "[Gen 9 Champions] VGC 2026 Reg M-C",
  "generated": "2026-10-10T23:40:00Z",
  "entries": [
    {
      "id": "limitless-7178",
      "title": "Juan Francisco Salerno — Regional Recife (1st)",
      "player": "Juan Francisco Salerno", "event": "Regional Recife", "date": "2026-10-03",
      "tier": "regional", "placing": 1,
      "paste": "https://<host>/pastes/limitless-7178.txt",      // plain Showdown text, the go-between
      "spreads": "estimated" | "confirmed" | "partial",           // per team; per-mon detail lives in the paste's EV lines
      "replicaCodes": ["9NNN3", "N8A4G"],                       // optional
      "source": "https://limitlessvgc.com/teams/7178"
    }
  ]
}
```

Rules: the paste is pure Showdown text (no comments, so Showdown/pokepast.es import keeps working); a set WITH an `EVs:` line is confirmed, a set WITHOUT one is for App 1 to fill and label. Metadata never goes inside the paste. The feed is static JSON, so it can be hosted anywhere (Cloudflare Pages, GitHub Pages, R2) and cached by the browser.

## App 2 — vgc-meta (new repo, not upstream-bound)

**Modules** (each a folder; the entrypoint stays thin per the global rule):
1. `sources/` — one fetcher per source: Smogon chaos (usage), Limitless VGC, crob.at, Victory Road, YouTube (needs `YOUTUBE_API_KEY`), later X. These already exist on `feature/top-teams-data` / `feature/top-teams` and move over as-is.
2. `store/` — **SQLite** (`node:sqlite`, built into Node 22+; no server): tables `teams`, `sets`, `spreads` (value + provenance: player paste / YouTube / Smogon estimate), `sources` (fetched-at, counts), `sim_runs`, `sim_results`. One file, committed as a release artifact, not to git.
3. `publish/` — writes `public/feed.json` + `public/pastes/<id>.txt` (+ optionally mirrors a paste to pokepast.es so it has a shareable link).
4. `sim/` — the battle simulator (below). Input: my team's paste + the feed's pastes. Output: a report (best leads, odds, win rate per meta team, overall) and **a pokepaste of my team with the spreads the sims favoured**, so the result flows into App 1 the same way as everything else.
5. `cli/` — `vgc-meta refresh [--source …]`, `vgc-meta publish`, `vgc-meta sim <my-paste> [--top 50] [--battles 200]`.

**Running it:** locally by CLI first (fast to build, nothing to host) — this is where it still is on 2026-10-11. ⚠️ The nightly GitHub Actions idea below is BLOCKED by the owner's rule (2026-10-11: no GitHub Actions on a private repo; vgc-meta is private, so it would have to be made public first — the owner's call). Original idea: a nightly **GitHub Actions** cron runs `refresh` + `publish` and deploys `public/` to **Cloudflare Pages** (the owner's estate pattern; static, free, no CPU limits in the build job, secrets in Actions). The simulation stays a local/CI CLI until its cost is known.

**Simulation engine — DECIDED and built:** Pokémon Showdown's engine installed from a pinned GitHub commit (`942cda71d14b…`, master on 2026-10-10), Reg M-C; details, the player's features and every measurement live in vgc-meta's `docs/info/SIMULATION.md`. The spike that led there, for the record — **MEASURED 2026-10-10 17:30 (spike in the session scratchpad, `pokemon-showdown@0.11.11` from npm, Node 24):** the npm package ships a `champions` mod; format "[Gen 9 Champions] VGC 2026 Reg M-B" exists (doubles); 20 doubles battles with the built-in random AI ran in 605 ms (~30 ms each, one core); the sim computes stats with the Champions Stat Point formula (Rillaboom 32 HP SP → 207 HP = 100+32+75; Adamant 32 Atk SP → 194), so Stat Points work natively. ⚠️ The npm release (2026-07-28) is Reg M-B: its validator says Rillaboom "does not exist" and some M-C learnset moves are missing; GitHub master already carries Reg M-C (`mod: champions` = M-C, `championsregmb` = M-B), so App 2 installs the simulator from GitHub master (or the next npm release). Validation is skipped for sims anyway; mechanics/learnsets must be M-C. **Decision: route (a).** What we build is the PLAYER (move/target/switch policy and lead selection), not the engine. Original options for the record: the planner's own engine (`src/domain/simulation/`) simulates *planned* turns with expected damage; it has no AI and does not pick moves, so it cannot play out a whole battle by itself. Two routes:
- (a) **Pokémon Showdown's simulator** (`@pkmn/sim`, battle-stream API, deterministic with a seed) with a heuristic AI for both sides (greedy damage + protect/speed-control rules), Monte Carlo over lead pairs and seeds, run in `worker_threads` for parallelism. ⚠️ **Not yet verified that it implements Pokémon Champions rules** (Stat Points, the Champions stat formula, Mega + Tera). Showdown's ladder has `gen9championsvgc2026regmc`, so a mod exists server-side; whether `@pkmn/sim` ships it is the first thing to check.
- (b) Extend the planner's engine with a move-choice policy and run it as the battle loop. Fully under our control and already Champions-accurate, but a real battle engine is a large build.

Recommendation: measure (a) first (one afternoon: install `@pkmn/sim`, try to build a Champions team, run one battle); fall back to (b) only if Champions is not supported.

## Open questions for the owner — all three ANSWERED (2026-10-10)

1. ~~Confirm the reading of "the api for loading in the top spreads"~~ → YES: feed import + Estimated/Confirmed fill-in (owner, 2026-10-10 17:2x).
2. ~~Name and home for App 2~~ → `vgc-meta`, run LOCALLY until happy, Cloudflare Pages later (owner, 2026-10-10 17:4x); GitHub remote added 2026-10-11 as a PRIVATE repo.
3. ~~Move the pipeline branches now?~~ → moved: vgc-meta was seeded from `feature/top-teams` (conductor's call, 2026-10-10 17:4x); the fork's branches stay as the record.

## Questions to save for the upstream maintainers (do not decide here)

- Would they take a "team feed" import at all, and in what shape (settings UI vs a build-time constant)?
- The separate aggregation service: never part of the upstream PR; mention it only as context.
