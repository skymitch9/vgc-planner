# Morning test guide — what was built overnight and how to try each piece

> Audience: the owner, testing on the morning of 2026-10-11. Status: TRACKED (fork-only docs). Last verified: 2026-10-11 03:35 Phoenix — the servers below were answering at that time; each item says what was and was NOT verified. Rewritten as the night goes on; see `docs/TODO.md` for the live state.

## What should already be running on this machine

| Thing | Address | If it is not answering |
|---|---|---|
| Planner (App 1) dev server | http://localhost:5173 | in `vgc-planner`: `npm run dev` |
| Team feed server (App 2's published output) | http://localhost:4400/feed.json | in `vgc-meta`: `npx serve@14.2.4 public -l 4400 --cors` |
| Coach server | http://127.0.0.1:4410/health | in `vgc-meta`: `npm run coach` |

## App 1 — the planner (http://localhost:5173)

| # | Try this | Expect | Not verified |
|---|---|---|---|
| 1 | Open your **Sal Z** team | Real Pokémon/item icons (sprites were never downloaded for this checkout; fixed with `npm run sprites`) | — |
| 2 | Team page → **★ Top teams** | 1,372 teams from the feed; chips All / Official / Online / Ranked / Creator; tick **Only confirmed spreads** → about 667; Regional top cuts show **Confirmed spreads** + replica codes | phone widths; production CSP (KI-2) |
| 3 | Expand a team → **Use as my team** on an *Estimated* one | Team replaced; **Estimated spread** chips on its cards; editing a spread clears that chip | — |
| 4 | Expand a team → **Plan against this team** | A new gameplan opens with 6 opponent Pokémon | — |
| 5 | Sidebar **Import** (or **Bulk import** next to New team) | One dialog, two tabs. *Teams from pastes*: paste several pokepast.es links / Showdown teams separated by `---` / a Showdown backup with `=== [format] Name ===` headers → **Preview** → rename, untick, **Import N teams**. *Backup file (JSON)*: the old import | VR Pastes links live; the 50-item cap in the browser |
| 6 | A team → **New gameplan** → **Use a saved team…** | Lists your saved teams; picking one fills the opponent box (a copy, not a link) | — |
| 7 | Open a gameplan, add a turn, pick moves | Every move name is coloured by type (canvas, turn editor badge, results); hover shows the type | the first-login tour |
| 8 | In the turn editor choose **U-turn**, **Heat Wave**, **Protect** | U-turn offers single targets only; Heat Wave locked to *Both foes*; Protect locked to *Self* | Tailwind / Helping Hand in the browser |

Known issue while testing: the repo's own browser smoke test (`npm run test:e2e`) times out at its damage-calculator step on main (KI-1). It does not affect the app in the browser.

## App 2 — vgc-meta (the folder next to this repo; private repo skymitch9/vgc-meta)

Run these in `vgc-meta`. `npm run status` first: it prints every table's counts in one screen.

| # | Command | What it shows | Not verified |
|---|---|---|---|
| 1 | `npm run status` | 1,372 teams, 667 with published spreads; set library 780 pastes / 4,680 sets / 158 species; real data 16,030 matches + 4,447 replays; matrix cache | — |
| 2 | `npm run paste -- add <pokepast.es link>` then `npm run paste -- list` | Your paste's six sets join the set library, marked as your upload | a file / a VR Pastes link by hand |
| 3 | `npm run sim -- --team data/sim-input/sal-z.txt --top 30` | Sal Z vs the top 30: best leads, bring fours, odds (about 17 min at full depth) | ⚠️ the player is still v1 (see below) |
| 4 | `npm run improve -- --team data/sim-input/sal-z.txt --top 30` | Ranked legal changes to the team + the combined team as a pokepaste (about 30 min) | ⚠️ v1 pushes toward raw damage; treat as leads |
| 5 | `npm run realdata -- sample` | Five real matches and three real replays, as parsed | — |
| 6 | `npm run refresh` then `npm run publish` | Re-polls every source (Smogon usage, Limitless, crob.at, Victory Road, YouTube ×18 channels, VGCPastes sheet) and rewrites the feed | a full all-source refresh in one go after tonight's merges |

### The coach (Showdown adviser)

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → choose `vgc-meta/extension`.
2. Open or reload https://play.pokemonshowdown.com and start a battle. A **VGC coach** panel appears bottom right ("● recording").
3. Play one game with **Live suggestions** OFF, then in `vgc-meta`: `npm run coach -- review`.
4. Tick **Live suggestions**: matched known team, predicted leads, ranked choices, and the suggested button outlined.

⚠️ NOT verified on the real site: nobody has logged in or played with it. It was tested on a mock battle page and built from the classic Showdown client's source. If the panel stays on "waiting for the battle log", the client differs from what it expects (the newer Showdown client is not supported). Live help in rated ladder games is against Showdown's rules; the switch is manual and defaults to off, by your decision.

## What is built but NOT turned on yet

- **Player v2** (12 toggleable features: weather/terrain, abilities/items, speed, Fake Out, Protect, speed control, redirection, setup, status, switching, lookahead, Revival Blessing fix). Built and measured on branch `feature/player-v2` in `../vgc-meta-player`; it beat the old player 74.6% with zero illegal choices. ⛔ NOT merged: the `git merge main` it needs was refused by the permission system for the agent and then for the conductor. **Say "approve the merge"** (or run it yourself: steps in `docs/TODO.md`, entry 2026-10-11 01:50).
- Until that lands, `sim`, `improve`, `matrix` and the coach all use the old player, whose calls on real matches were no better than a coin flip (133 games, 49.6%).

## Still in progress when this was written

- The measurement build (`../vgc-meta-calibrate`): does the sim predict real match winners, and does the player choose what humans choose? Results → `docs/DONE.md` here and `docs/info/CALIBRATION.md` in vgc-meta when it lands.
- Queued behind player v2: real lead/bring weights, a policy fitted to human choices, tiered all-vs-all sims, then the team builder.
