# info/ — how and why it works

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-11 ~18:00 Phoenix — the three docs below exist and their one-line summaries match their current content (re-read in this pass). NOT checked: ARCHITECTURE.md against today's code.

| Doc | Covers |
|---|---|
| [SPLIT-ARCHITECTURE.md](SPLIT-ARCHITECTURE.md) | The App 1 (this fork) / App 2 (vgc-meta) split, joined by pokepastes and a feed.json; what was built (2026-10-11); the original design kept as the record |
| [UPSTREAM-PLAN.md](UPSTREAM-PLAN.md) | What to send back to phc4rdoso/vgc-planner (PR 0 team builder, A legal targets, B estimated spreads, C team feed; D–G the fork's PRs #1–#4; H the storage listener), upstream's movement, commits and files per PR, likely pushback, mechanics, questions for the maintainers |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers (ui → state → infra → domain), rendering safety, persistence, path to a backend — UPSTREAM's document (moved here from `docs/ARCHITECTURE.md` on 2026-10-10), kept without our header so it stays identical to theirs (byte-identical to `upstream/main:docs/ARCHITECTURE.md`, checked with `diff` 2026-10-11) |
