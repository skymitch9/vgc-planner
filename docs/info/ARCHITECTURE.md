# Architecture

## Goals

1. **Deployable as a static site today, and behind a real backend later** without rewriting the application.
2. **One source of truth for rules** (parsing, stats, simulation, validation) that doesn't depend on the browser.
3. **Safe with untrusted input**: pastes, imported files and stored data are all validated.

## Layers

```
ui  ──►  state  ──►  infra  ──►  domain
 │                     ▲           ▲
 └─────────────────────┴───────────┘      (domain imports nothing from the other layers)
```

- **domain**: data model (`types.ts`), Showdown parser, stat formula, tree helpers, the validated JSON codec, and the turn simulation. Plain TypeScript, no DOM. The simulation talks to the damage calculator through a small interface (`CalcLib`, `CalcEngine`), so tests inject a stand-in and a server could inject Node's `@smogon/calc`.
- **infra**: adapters. `LibraryRepository` (persistence), `PrefsStore` (view preferences), the calculator loader, sprite URLs.
- **state**: `AppStore` owns the library and view state and saves through the repository (debounced, errors surfaced). `SimService` owns the calculator's lifecycle and caches results per plan state.
- **ui**: string-template views, one module per screen area, a single delegated event listener (`data-act` attributes), and a render bus so views don't import each other.

## Stat Point optimizer

- **Where:** `src/domain/sp-optimizer.ts` (pure, no DOM) and its dialog `src/ui/sp-optimizer.ts`, opened by the "Optimize SPs" button in the team builder's editor. Off unless opened; nothing is written until Apply, and Apply offers Undo.
- **How it calls the calculator:** through the same `CalcEngine` as the turn simulation (`simService.ready()` in the browser, `createEngine(@smogon/calc)` in tests), so forms, items, abilities and the Champions stat formula match turn results. Pokémon are built with `newMonState` (`simulation/state.ts`), the function `initState` uses.
- **Search:** `minSpToKO` binary-searches the attacking stat (0–32; damage never drops as the stat rises), and past 32 counts on to say how many points a KO would need. `minSpToSurvive` searches HP and the hit defence together: HP walks up while the defence walks down, so a query costs tens of calculator calls instead of 33 × 33. Both respect 32 per stat and 66 in total (points over 66 come out of other stats, least useful first, Speed last) and can try a nature that raises the searched stat.
- **Writing back:** `rewriteSpread` replaces only that Pokémon's `EVs:` (and, on a nature change, `Nature`) line in the paste; every other line stays byte-for-byte.
- **Not modelled:** Intimidate and other entry effects, Multiscale / Focus Sash / Sturdy on the second of two hits, crits, stat stages.

## Rendering and safety

- Views build HTML strings. **Every dynamic value goes through `esc()`**; there is no other way text reaches `innerHTML`.
- No inline `<script>`, `style=""` or `on*=` handlers anywhere, so a strict CSP works (`script-src 'self'; style-src 'self'`). Dynamic widths and zoom are applied from script via `data-w` and a CSS variable.
- Imported/stored JSON is read by `domain/codec.ts`: types are checked per field, strings are length-capped, and the number of teams, plans, turns and the nesting depth are bounded.

## Persistence and data versions

- `LibraryRepository { load(): Promise<Library>; save(library): Promise<void> }`. The stored envelope is `{ schemaVersion, teams }`; readers reject newer versions and keep accepting older ones (the pre-restructure shape `{ teams, ui }` is still read).
- Export files have their own `version`. When a format changes, bump the version and add a migration step in `codec.ts` before validation; keep one test per old version.
- Version 2 (both the stored schema and export files): a gameplan holds `tabs`, each with its own `name`, `selection` (leads/backs) and turns. Version 1 gameplans, with one `selection` and one turn tree, are read as a single tab named "Plan 1".
- Ids are UUIDs, so records can be merged or synced later without remapping.

## Server (accounts)

The server is deliberately thin: the browser plans and simulates, the server signs people in and stores what they typed.

- **Worker** (`server/src/index.ts`): Cloudflare Worker serving `dist/` and `/api/*`. `server/src/app.ts` (sign-in, sessions) and `server/src/library.ts` (teams/gameplans) use only standard web APIs and run in Node tests against an in-memory store (`tests/helpers/memory-store.ts`); `store-d1.ts` is the D1 implementation.
- **Sign-in**: OAuth authorization-code flow with Discord (`identify`) or Google (`openid profile`); `state` in a short-lived HttpOnly cookie; 30-day sessions as random tokens in an HttpOnly, SameSite=Lax cookie, stored only as SHA-256. State-changing requests must carry the app's `Origin`.
- **Library**: rows are scoped by `(user_id, id)`, so ids chosen by a client can never reach another account. Each team / gameplan is one JSON document validated with `codec.ts` (the same rules as imports) and versioned; writes carry `baseVersion` and get 409 on mismatch. Quotas cap teams, gameplans, bytes and request size.
- **Client**: `AccountRepository` implements `LibraryRepository`: one `GET /api/library` on sign-in, then per-record `PUT`/`DELETE` for what changed since the last confirmed save. `AppStore.useRepository()` swaps between it and the device's `LocalStorageRepository` on sign-in / sign-out; nothing else in the UI knows where data lives.
- **Possible next steps**: Cloudflare rate-limiting rules on `/api/auth/*` and writes; sharing read-only gameplans by link; resolving edit conflicts in place instead of asking for a reload.

## Testing strategy

- **Unit (`npm test`)**: parser, stat formula, codec (round trips, validation, limits, legacy data), repository behaviour (including failure and corruption paths), `SimService` caching/retry, sprite URL rules, and the simulation using `tests/helpers/stub-calc.ts`.
- **E2E (`npm run test:e2e`)**: the real UI in Chromium: create team and gameplan, edit a turn, results, export, reload, import; fails on any console error (including CSP violations).
- The stand-in calculator keeps tests deterministic and offline. Correctness of the damage numbers themselves is the calculator's job; the simulation tests check what this app adds (order, targets, state carried between turns).
