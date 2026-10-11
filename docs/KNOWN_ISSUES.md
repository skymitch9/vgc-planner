# Known issues — accepted defects, waivers, exceptions

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-10 (scaffold only; nothing measured beyond the repo tree).

None recorded yet. Each entry carries: Symptom · Status (ACCEPTED/WAIVED/BLOCKED/WATCHING) · Why tolerated · What would change it.

## KI-1 · `npm run test:e2e` (e2e/smoke.mjs) times out at `.turn-result .hp-row` on main
- **Symptom:** the browser smoke test creates a team and gameplan fine, then waits forever for a turn result's HP row. Measured 2026-10-10 by the legal-targets agent against an unmodified `main` served from a throwaway worktree, so it predates every branch of this session.
- **Status:** WATCHING.
- **Why tolerated:** unit tests (192) cover the simulation; the smoke test's earlier steps still pass; the likely cause is the damage calculator chunk not loading in that environment, not a product defect seen by users (not confirmed).
- **What would change it:** a run of `npm run build && npm run preview` + `npm run test:e2e` that passes, or a diagnosis showing a real regression (then it becomes a TODO item).

## KI-2 · A deployed build cannot reach a team feed until the production CSP allows its origin
- **Symptom:** in production the `connect-src` of the Content-Security-Policy (`public/_headers`, `deploy/security-headers.inc`) does not list any feed origin, so the Top teams picker's feed fetch is blocked there. Local dev has no CSP and works (measured 2026-10-10, PR #3).
- **Status:** ACCEPTED until App 2 (vgc-meta) has a public home.
- **Why tolerated:** the feed only exists on localhost:4400 today (owner decision 2026-10-10: run App 2 locally until happy); adding an origin before it exists would be a guess.
- **What would change it:** the vgc-meta feed getting a public URL (Cloudflare Pages). Then add that origin to both CSP files in the same PR that sets the production default feed URL.

## KI-3 · Never `rm -rf` an agent worktree whose `node_modules` may be a junction (gotcha, cost real time 2026-10-11)
- **Symptom:** `npm run check` on the main tree failed with "'tsc' is not recognized": the main tree's `node_modules` had lost `.bin` and several packages. Cause (inferred from the timeline, not reproduced): on 2026-10-10 ~18:00 a worktree's `node_modules` was a JUNCTION to the main tree's, and the conductor's `rm -rf` of that worktree followed it. The running dev server hid the damage for seven hours because Vite had everything in memory.
- **Status:** ACCEPTED as a standing hazard; repaired by `npm install` (6 packages added, 15 changed) on 2026-10-11 01:04.
- **Why tolerated:** cannot be prevented by the repo; it is an operator rule.
- **What would change it:** agents are briefed to `npm install` in their worktree instead of linking; removal is `git worktree remove` only, and if that refuses, check `(Get-Item <wt>\node_modules).LinkType` before deleting anything by hand. Also `.claude/worktrees/agent-a408f7c610631b9f1` is an empty leftover folder that Windows reports busy; it is harmless and untracked.

## KI-4 · Two open planner tabs overwrite each other's library (incident 2026-10-11)
- **Symptom:** the planner keeps the whole library in browser localStorage and every tab holds its own in-memory copy; a save from one tab writes its copy over everything, silently dropping changes made in another tab since it loaded. On 2026-10-11 ~13:2x the conductor imported two teams from a tab loaded ten hours earlier and overwrote the owner's team rename ("Sal Z" → "Garchomp Z") and his new "Salamence" team in storage. The owner's own tab still held his state in memory.
- **Status:** WATCHING (an upstream design property of the app, not something this fork introduced).
- **Why tolerated:** single-user, single-tab use never hits it; signed-in accounts sync through the server instead.
- **What would change it:** a `storage` event listener that reloads the library when another tab saves (small, upstream-worthy), or merging on save. Until then: reload the tab before any write (rule saved in the conductor's memory), and never write localStorage directly.
