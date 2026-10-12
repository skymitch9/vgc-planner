# access/ — how to operate it

> Audience: future Claude sessions and the owner. Status: TRACKED. Last verified: 2026-10-11 ~17:50 Phoenix (every link below resolves to a file in this tree; script names re-read from `package.json`. NOT checked: the deploy steps themselves — never run from this checkout).

| Topic | Where |
|---|---|
| Local dev (`npm run dev` on :5173, `npm run dev:api` on :8787, `db:migrate:local`) | top-level [README.md](../../README.md) "Scripts" and "Accounts" |
| Deploy (Cloudflare Worker + D1, `npm run deploy`) — ⚠️ `wrangler.toml` points at UPSTREAM's production (vgcplanner.app); see RECOVERY §5 | top-level README "Deploy to Cloudflare"; `wrangler.toml` |
| Sending a PR back to the main/upstream project (docs/ must be excluded) | [CONTRIBUTING-UPSTREAM.md](CONTRIBUTING-UPSTREAM.md) |
| How to try each piece of both apps today (servers, clicks, commands, what is not verified) — the owner's test guide | [MORNING-TEST.md](MORNING-TEST.md) |
| Secrets: names and custody (1Password vault **VGC Planner**, .dev.vars) | [SECRETS.md](SECRETS.md) |
| Recovery / rebuild plan from nothing but git (and the GAP: the owner's library lives only in browser localStorage) | [RECOVERY.md](RECOVERY.md) |
