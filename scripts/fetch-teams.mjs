#!/usr/bin/env node
/**
 * Builds src/data/teams-mc.json (the "Top teams" data): real top-player teams for Reg M-C, with replica codes
 * where published.
 *
 *   npm run teams                               # every source, live
 *   npm run teams -- --source limitless         # one source (limitless | crob | victoryroad); repeatable
 *   npm run teams -- --limit 5                  # at most 5 teams fetched per source (a quick run)
 *   npm run teams -- --all-crob                 # keep every crob.at team even past the 350 KB size cap
 *   npm run teams -- --offline tests/fixtures/teams --out /tmp/teams.json
 *                                               # saved pages instead of the network (see below)
 *
 * Sources: Limitless VGC (official events), crob.at (community online tournaments, public API) and Victory Road's
 * Champions Replica Teams page (codes; matched onto the same team from the other sources by species + player).
 * Requests are sequential, at least 250 ms apart, with retries on 429/5xx and a 20 s timeout each.
 *
 * Names are resolved with src/data/champions-mc.json (run `npm run champions-data` first when it is missing); a
 * team whose Pokémon, item, ability or move doesn't resolve, or that the app's own legality check flags, is
 * skipped and listed at the end. Spreads are kept only when a player published them (no source invents one).
 *
 * Offline files are named <kind>-<key>.<ext>: limitless-listing-1.html, limitless-tournaments-all.html,
 * limitless-team-7178.html, crob-listing-1.html, crob-team-tq7KCk.json, victoryroad-page.html,
 * pokepaste-<id>.json, vrpastes-<id>.json. A missing file just means "not there".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTeams } from './teams-build.mjs';
import { politeFetch } from './teams-common.mjs';
import * as limitless from './teams-limitless.mjs';
import * as crob from './teams-crob.mjs';
import * as vr from './teams-victoryroad.mjs';
import { parsePasteLink } from '../src/domain/paste-links.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEX = path.join(root, 'src/data/champions-mc.json');
const USAGE = path.join(root, 'src/data/usage-mc.json');
const ALL = ['limitless', 'crob', 'victoryroad'];

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const sources = values('--source').length ? values('--source') : ALL;
for (const s of sources) if (!ALL.includes(s)) throw new Error(`Unknown --source ${s}; use ${ALL.join(', ')}`);
const limit = values('--limit').length ? Number(values('--limit')[0]) : Infinity;
const offline = values('--offline')[0];
const OUT = path.resolve(values('--out')[0] ?? path.join(root, 'src/data/teams-mc.json'));

const EXT = { 'crob-team': 'json', pokepaste: 'json', vrpastes: 'json' };
const URLS = {
  'limitless-listing': (page) => limitless.listingUrl(Number(page)),
  'limitless-tournaments': () => limitless.TOURNAMENTS_URL,
  'limitless-team': (id) => limitless.teamUrl(id),
  'crob-listing': (page) => crob.listingUrl(Number(page)),
  'crob-team': (slug) => crob.teamApiUrl(slug),
  victoryroad: () => vr.VR_URL,
  pokepaste: (id) => parsePasteLink(`https://pokepast.es/${id}`).api,
  vrpastes: (id) => parsePasteLink(`https://vrpastes.com/${id}`).api,
};

let requests = 0;
async function load(kind, key) {
  if (offline) {
    const file = path.resolve(offline, `${kind}-${key}.${EXT[kind] ?? 'html'}`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  requests++;
  if (requests % 50 === 0) console.log(`  ...${requests} requests`);
  return politeFetch(URLS[kind](key));
}

const today = new Date().toISOString().slice(0, 10);
console.log(`Refreshing Reg M-C top teams from ${sources.join(', ')}${offline ? ` (offline: ${offline})` : ''}...`);
const { data, skipped, notes } = await buildTeams({
  load,
  dexData: JSON.parse(fs.readFileSync(DEX, 'utf8')),
  usageData: fs.existsSync(USAGE) ? JSON.parse(fs.readFileSync(USAGE, 'utf8')) : null,
  sources,
  limit,
  today,
  log: (line) => console.log(line),
  crobCapBytes: args.includes('--all-crob') ? Infinity : undefined,
});

const json = JSON.stringify(data);
fs.writeFileSync(OUT, json);
const count = (id) => data.sources.find((s) => s.id === id);
const parts = data.sources.map((s) => (s.id === 'victoryroad' ? `victoryroad ${s.merged ?? 0} merged/${s.teams} own` : `${s.id} ${s.teams}`));
console.log(`Wrote ${path.relative(root, OUT) || OUT}: ${data.teams.length} teams (${parts.join(', ')}), ${(json.length / 1024).toFixed(0)} KB` +
  (offline ? '' : `, ${requests} requests`));
const known = data.teams.filter((t) => t.setsKnown);
const spreads = data.teams.filter((t) => t.sets.some((s) => s.evs));
console.log(`  ${known.length} with full sets, ${data.teams.length - known.length} species only; ${spreads.length} with published spreads` +
  (count('victoryroad') ? `; ${data.teams.filter((t) => t.replicaCodes).length} with replica codes` : ''));
if (notes.length) {
  console.log(`Adjusted ${notes.length} set(s):`);
  for (const n of notes) console.log(`  ${n.id}: ${n.note}`);
}
if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  ${s.id}: ${s.reason}`);
}
