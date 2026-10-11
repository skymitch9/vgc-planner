# Secrets — names and custody (never values)

> Audience: future Claude sessions and the owner. Status: TRACKED (so: NAMES ONLY, no values, ever). Last verified: 2026-10-10 17:10 Phoenix (vault and item `YOUTUBE_API_KEY` exist, id 5qynicoj4wgi7carpuz2hqwjue; value filled by the owner; `.dev.vars` filled from it via `op read`, never through chat).

| Name | What it buys | Custody (where a copy lives / where it is re-minted) |
|---|---|---|
| `YOUTUBE_API_KEY` | The YouTube paste harvester in `npm run teams`: scans named channels' video descriptions for pokepast.es / vrpastes.com links (confirmed spreads). Optional; unset skips that source. | 1Password vault **VGC Planner** (id `qlqhwozj6wytnqkyttjvhwqlea`, created 2026-10-10 17:03 Phoenix); gitignored `.dev.vars`; re-mint at console.cloud.google.com → project **vgc-planner** → APIs & Services → Credentials (YouTube Data API v3 is enabled there). |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Sign in with Discord (see README "Accounts") | Not yet minted for this checkout (no `.dev.vars` existed on 2026-10-10). Discord Developer Portal. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sign in with Google (see README "Accounts") | Not yet minted for this checkout. Google Cloud Console OAuth client. |

Conventions: one 1Password vault per app (same as Black Bloc); item titles are the variable NAME; `.dev.vars.example` is the authority on which names exist.
