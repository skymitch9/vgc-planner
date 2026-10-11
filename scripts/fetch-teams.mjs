#!/usr/bin/env node
/**
 * Builds src/data/teams-mc.json (the "Top teams" data): real top-player teams for Reg M-C, with replica codes
 * where published.
 *
 *   npm run teams                               # every source, live
 *   npm run teams -- --source limitless         # one source (limitless | crob | victoryroad | youtube); repeatable
 *   npm run teams -- --limit 5                  # at most 5 teams fetched per source (a quick run)
 *   npm run teams -- --all-crob                 # keep every crob.at team even past the 350 KB size cap
 *   npm run teams -- --offline tests/fixtures/teams --out /tmp/teams.json
 *                                               # saved pages instead of the network (see below)
 *
 * Sources: Limitless VGC (official events), crob.at (community online tournaments, public API) and Victory Road's
 * Champions Replica Teams page (codes; matched onto the same team from the other sources by species + player), and
 * YouTube: pokepast.es / vrpastes.com links in the descriptions of the channels in scripts/teams-youtube.mjs,
 * usually with real spreads. YouTube needs YOUTUBE_API_KEY (environment, or the line in .dev.vars); without it that
 * source is skipped and the others still run.
 * Requests are sequential, at least 250 ms apart, with retries on 429/5xx and a 20 s timeout each.
 *
 * Names are resolved with src/data/champions-mc.json (run `npm run champions-data` first when it is missing); a
 * team whose Pokémon, item, ability or move doesn't resolve, or that the app's own legality check flags, is
 * skipped and listed at the end. Spreads are kept only when a player published them (no source invents one).
 *
 * Offline files are named <kind>-<key>.<ext>: limitless-listing-1.html, limitless-tournaments-all.html,
 * limitless-team-7178.html, crob-listing-1.html, crob-team-tq7KCk.json, victoryroad-page.html,
 * pokepaste-<id>.json, vrpastes-<id>.json, youtube-channel-<handle>.json, youtube-playlist-<id>[~<token>].json.
 * A missing file just means "not there".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTeams } from './teams-build.mjs';
import { politeFetch } from './teams-common.mjs';
import * as limitless from './teams-limitless.mjs';
import * as crob from './teams-crob.mjs';
import * as vr from './teams-victoryroad.mjs';
import * as yt from './teams-youtube.mjs';
import { parsePasteLink } from '../src/domain/paste-links.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEX = path.join(root, 'src/data/champions-mc.json');
const USAGE = path.join(root, 'src/data/usage-mc.json');
const ALL = ['limitless', 'crob', 'victoryroad', 'youtube'];

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
let sources = values('--source').length ? values('--source') : ALL;
for (const s of sources) if (!ALL.includes(s)) throw new Error(`Unknown --source ${s}; use ${ALL.join(', ')}`);
const limit = values('--limit').length ? Number(values('--limit')[0]) : Infinity;
const offline = values('--offline')[0];
const OUT = path.resolve(values('--out')[0] ?? path.join(root, 'src/data/teams-mc.json'));

const EXT = { 'crob-team': 'json', pokepaste: 'json', vrpastes: 'json', 'youtube-channel': 'json', 'youtube-playlist': 'json' };

// The key is only ever put into a request URL; errors are printed with it blanked out.
const ytKey = offline ? '' : yt.readYoutubeKey(root);
if (sources.includes('youtube') && !offline && !ytKey) {
  console.log('youtube: skipped (no YOUTUBE_API_KEY)');
  sources = sources.filter((s) => s !== 'youtube');
}
const URLS = {
  'limitless-listing': (page) => limitless.listingUrl(Number(page)),
  'limitless-tournaments': () => limitless.TOURNAMENTS_URL,
  'limitless-team': (id) => limitless.teamUrl(id),
  'crob-listing': (page) => crob.listingUrl(Number(page)),
  'crob-team': (slug) => crob.teamApiUrl(slug),
  victoryroad: () => vr.VR_URL,
  pokepaste: (id) => parsePasteLink(`https://pokepast.es/${id}`).api,
  vrpastes: (id) => parsePasteLink(`https://vrpastes.com/${id}`).api,
  'youtube-channel': (handle) => yt.channelUrl(handle, ytKey),
  'youtube-playlist': (key) => {
    const { playlistId, pageToken } = yt.splitPlaylistKey(key);
    return yt.playlistUrl(playlistId, pageToken, ytKey);
  },
};

let requests = 0;
async function load(kind, key) {
  if (offline) {
    const file = path.resolve(offline, `${kind}-${key}.${EXT[kind] ?? 'html'}`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  requests++;
  if (requests % 50 === 0) console.log(`  ...${requests} requests`);
  if (!kind.startsWith('youtube-')) return politeFetch(URLS[kind](key));
  try {
    return await politeFetch(URLS[kind](key));
  } catch (err) {
    throw new Error(yt.hideKey(err.message, ytKey));
  }
}

const today = new Date().toISOString().slice(0, 10);
console.log(`Refreshing Reg M-C top teams from ${sources.join(', ')}${offline ? ` (offline: ${offline})` : ''}...`);
if (!sources.length) process.exit(0);
const { data, youtube, skipped, notes } = await buildTeams({
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
const parts = data.sources.map((s) => (s.merged !== undefined ? `${s.id} ${s.merged} merged/${s.teams} own` : `${s.id} ${s.teams}`));
console.log(`Wrote ${path.relative(root, OUT) || OUT}: ${data.teams.length} teams (${parts.join(', ')}), ${(json.length / 1024).toFixed(0)} KB` +
  (offline ? '' : `, ${requests} requests`));
const known = data.teams.filter((t) => t.setsKnown);
const spreads = data.teams.filter((t) => t.sets.some((s) => s.evs));
const allSpreads = data.teams.filter((t) => t.sets.every((s) => s.evs));
console.log(`  ${known.length} with full sets, ${data.teams.length - known.length} species only; ${spreads.length} with published spreads (${allSpreads.length} for all six)` +
  (count('victoryroad') ? `; ${data.teams.filter((t) => t.replicaCodes).length} with replica codes` : ''));
if (notes.length) {
  console.log(`Adjusted ${notes.length} set(s):`);
  for (const n of notes) console.log(`  ${n.id}: ${n.note}`);
}
if (youtube) console.log(`  youtube: ${JSON.stringify(youtube)}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  ${s.id}: ${s.reason}`);
}
