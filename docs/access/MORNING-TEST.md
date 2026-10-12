# Test guide — how to try each piece of both apps

> Audience: the owner. Status: TRACKED (fork-only docs). Last verified: 2026-10-11 17:47 Phoenix — the three servers below answered a GET at that time (planner 200; feed.json 1,372 entries, generated 09:56 UTC; coach `/health` ok with all sixteen features listed); the `tiers` process was alive (started 13:37); `data/sim-features.json` in vgc-meta read (sixteen features). Rows carry their own "not verified". NOT re-run for this update: any of the commands in the tables (no tests, builds or sims were started). First written for the morning of 2026-10-11; `docs/TODO.md` holds the live state.

## What should already be running on this machine

| Thing | Address | If it is not answering |
|---|---|---|
| Planner (App 1) dev server | http://localhost:5173 | in `vgc-planner`: `npm run dev` |
| Team feed server (App 2's published output) | http://localhost:4400/feed.json | in `vgc-meta`: `npx serve@14.2.4 public -l 4400 --cors` |
| Coach server (sixteen-feature player) | http://127.0.0.1:4410/health | in `vgc-meta`: `npm run coach` (restart it after changing `data/sim-features.json`) |
| ⏳ Tiered sims on the official tier (started 13:37, local CPU only) | — (writes `data/sim/tiers-<time>/tiers.md` when done) | it is resumable: rerun the same command (row 8 below) |

⚠️ **One planner tab at a time, and reload it before you change anything** (KNOWN_ISSUES KI-4: a stale second tab overwrites your library). Your teams live only in this browser: sidebar **Export all** saves a backup file ([RECOVERY.md](RECOVERY.md)).

## App 1 — the planner (http://localhost:5173)

| # | Try this | Expect | Not verified |
|---|---|---|---|
| 1 | Open one of your teams | Real Pokémon/item icons (from `npm run sprites`, run once for this checkout) | — |
| 2 | Team page → **★ Top teams** | 1,372 teams from the feed; chips All / Official / Online / Ranked / Creator; tick **Only confirmed spreads** → about 667; Regional top cuts show **Confirmed spreads** + replica codes. The header lists the feed's sources (the "Limitless play (tournament results) 0" item is real feed data: that source holds match results, not teams) | phone widths; production CSP (KI-2) |
| 3 | Expand a team → **Use as my team** on an *Estimated* one | Team replaced; **Estimated spread** chips on its cards; editing a spread clears that chip | — |
| 4 | Expand a team → **Plan against this team** | A new gameplan opens with 6 opponent Pokémon | — |
| 5 | Sidebar **Import** (or **Bulk import** next to New team) | One dialog, two tabs. *Teams from pastes*: paste several pokepast.es links / Showdown teams separated by `---` / a Showdown backup with `=== [format] Name ===` headers → **Preview** → rename, untick, **Import N teams**. *Backup file (JSON)*: the old import | VR Pastes links live; the 50-item cap in the browser |
| 6 | A team → **New gameplan** → **Use a saved team…** | Lists your saved teams; picking one fills the opponent box (a copy, not a link) | — |
| 7 | Open a gameplan, add a turn, pick moves | Every move name is coloured by type (canvas, turn editor badge, results); hover shows the type | the first-login tour |
| 8 | In the turn editor choose **U-turn**, **Heat Wave**, **Protect** | U-turn offers single targets only; Heat Wave locked to *Both foes*; Protect locked to *Self* | Tailwind / Helping Hand in the browser |
| 9 | **Duplicate** a team (team page top bar, or the sidebar team menu) | A dialog asks for the copy's name (default "<name> (copy)") and offers **Copy its gameplans too (N)**; the copy appears right after the original, Estimated-spread labels included | narrow screens (PR #4, merged 13:25) |

Known issue while testing: the repo's own browser smoke test (`npm run test:e2e`) timed out at its damage-calculator step on 2026-10-10 (KI-1; not re-run since). It does not affect the app in the browser.

## App 2 — vgc-meta (the folder next to this repo; private repo skymitch9/vgc-meta)

**Player v2 + the switching features are ON by default since 13:10 today:** `data/sim-features.json` in vgc-meta enables all sixteen features (your choice), so `sim`, `improve`, `matrix`, `tiers`, `calibrate`, `agree`, `teambuild --sim` and the coach all use them unless you pass `--features`. What the measurements say: the player now plays much more like a human (move agreement 32.5% → 36.6%; it makes 26.0% of human switches, was 9.6%) but does **not** pick real winners better (53.9% vs 53.8%; player skill alone 56.2%; added value +0.8 points, inside the noise). Use sims to rank leads/brings and as a second opinion; the calc report (`teambuild`) is the primary evidence.

Run these in `vgc-meta`. `npm run status` first: it prints every table's counts in one screen.

| # | Command | What it shows | Not verified |
|---|---|---|---|
| 1 | `npm run status` | 1,372 teams, 667 with published spreads; set library 780 pastes / 4,680 sets / 158 species; real data 16,030 matches + 4,447 replays; sim cache; a `Tiers:` line for the newest run | — |
| 2 | `npm run paste -- add <pokepast.es link>` then `npm run paste -- list` (`paste remove <id>` to undo) | Your paste's six sets join the set library, marked as your upload; nothing is sent anywhere | a file / a VR Pastes link by hand |
| 3 | `npm run sim -- --team data/sim-input/sal-z.txt --top 30` | Your team vs the top 30: best leads, bring fours, odds | ⚠️ it simulates ALL 90 brings, including two-Mega and no-Mega ones you would rarely pick (the one-Mega bring rule is approved, not built yet); slower than v1 (~230 battles/s) |
| 4 | `npm run improve -- --team data/sim-input/sal-z.txt --top 30` | Ranked legal changes to the team + the combined team as a pokepaste | not re-run on the sixteen-feature player; treat as leads |
| 5 | `npm run realdata -- sample` | Five real matches and three real replays, as parsed | — |
| 6 | `npm run teambuild` (or `-- --around "Garchomp"`, or `-- --team <your paste>` for a calc report on your own team; add `--sim` for sims on the sixteen features) | A legal six as a pokepaste, a spread sheet with calc-justified custom spreads, a lead/bring chart vs 12 common matchups, weaknesses; about 20–30 s without `--sim`. Output folder printed at the end (`data/teambuild/<time>/`) | whether the team wins real games; it re-ranks known teams; it does not check item/terrain synergy yet (default build put Psychic Seed on Sneasler with no Psychic Terrain) |
| 7 | `npm run calibrate -- report` | How the sim scores against real matches: v2 53.9% vs v1 53.8%, skill alone 56.2%, no measurable added value | calibration of the full sixteen-feature set at scale (queued) |
| 8 | ⏳ `npm run tiers -- --tier official --keep1 30 --keep2 8 --opponents 24 --workers 31` — RUNNING since 13:37 | The official-tier ranking on the sixteen-feature player → `data/sim/tiers-<time>/tiers.md` + `ranking.csv`. ETA ~18:30 (estimate; the dry run's 40 min assumed v1 speed). Rerun the same command to resume if it stops. `npm run tiers -- --dry-run` shows any plan without simulating | the full feed (1,271 teams; ~8.5–14 h — your call); rankings are "for that player", not for humans; spoiler cap default (your call) |
| 9 | `npm run refresh` then `npm run publish` | Re-polls every source (Smogon usage, Limitless, crob.at, Victory Road, YouTube ×18 channels, VGCPastes sheet, real results/replays) and rewrites the feed | a full all-source refresh in one go; don't run it while `tiers` is running |
| 10 | Stop the coach (Ctrl+C in its window), then `npm run coach` | Restart after any change to `data/sim-features.json`; `/health` lists the enabled features | — |

### The coach (Showdown adviser)

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → choose `vgc-meta/extension`.
2. Open or reload https://play.pokemonshowdown.com and start a battle. A **VGC coach** panel appears bottom right ("● recording").
3. Play one game with **Live suggestions** OFF, then in `vgc-meta`: `npm run coach -- review`.
4. Tick **Live suggestions**: matched known team, predicted leads, ranked choices, and the suggested button outlined.

⚠️ NOT verified on the real site: nobody has logged in or played with it. It was tested on a mock battle page and built from the classic Showdown client's source. If the panel stays on "waiting for the battle log", the client differs from what it expects (the newer Showdown client is not supported). Live help in rated ladder games is against Showdown's rules; the switch is manual and defaults to off, by your decision. (Seen 17:47: `/health` lists all sixteen features but its `engine` field reads `ps-942cda71d14b+ai1+pair1`, the base tag without the feature hash — not investigated.)

## State when this was last updated (17:47, 2026-10-11)

Running: the official-tier `tiers` run (since 13:37, ETA ~18:30), the three servers above. Merged today: planner PRs #1–#4; vgc-meta PRs #1–#11 (player v2 and the switching features included). Approved and queued behind the tiers run: the one-Mega bring rule ("generally we only bring 1 mega"). What waits on you is the "Waiting on the owner" list in `docs/TODO.md`.
