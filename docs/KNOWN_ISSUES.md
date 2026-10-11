# Known issues — accepted defects, waivers, exceptions

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-10 (scaffold only; nothing measured beyond the repo tree).

None recorded yet. Each entry carries: Symptom · Status (ACCEPTED/WAIVED/BLOCKED/WATCHING) · Why tolerated · What would change it.

## KI-1 · `npm run test:e2e` (e2e/smoke.mjs) times out at `.turn-result .hp-row` on main
- **Symptom:** the browser smoke test creates a team and gameplan fine, then waits forever for a turn result's HP row. Measured 2026-10-10 by the legal-targets agent against an unmodified `main` served from a throwaway worktree, so it predates every branch of this session.
- **Status:** WATCHING.
- **Why tolerated:** unit tests (192) cover the simulation; the smoke test's earlier steps still pass; the likely cause is the damage calculator chunk not loading in that environment, not a product defect seen by users (not confirmed).
- **What would change it:** a run of `npm run build && npm run preview` + `npm run test:e2e` that passes, or a diagnosis showing a real regression (then it becomes a TODO item).
