#!/usr/bin/env node
/**
 * Builds src/data/usage-mc.json (the "Top builds" data) from Smogon's monthly usage stats for Reg M-C.
 *
 *   npm run usage                      # latest month, 1760+ ladder
 *   npm run usage -- 2026-09 1630      # a given month and rating cutoff (0, 1500, 1630, 1760)
 *   npm run usage -- --from chaos.json # an already downloaded chaos file
 *
 * IDs (abilities, items, moves) are turned into display names with src/data/champions-mc.json, so run
 * `npm run champions-data` first when that file is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduceChaos } from './usage-reduce.mjs';

const FORMAT = 'gen9championsvgc2026regmc';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src/data/usage-mc.json');
const DEX = path.join(root, 'src/data/champions-mc.json');

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const reducedIdx = args.indexOf('--reduced');

async function latestMonth() {
  const html = await (await fetch('https://www.smogon.com/stats/')).text();
  const months = [...html.matchAll(/href="(20\d\d-\d\d)\/"/g)].map((m) => m[1]).sort();
  if (!months.length) throw new Error('No months listed on smogon.com/stats');
  return months.at(-1);
}

let reduced;
let month = args.find((a) => /^20\d\d-\d\d$/.test(a));
const cutoff = args.find((a) => /^(0|1500|1630|1760)$/.test(a)) ?? '1760';
if (reducedIdx >= 0) {
  reduced = JSON.parse(fs.readFileSync(args[reducedIdx + 1], 'utf8'));
  month = reduced.month ?? month;
} else {
  let chaos;
  if (fromIdx >= 0) {
    chaos = JSON.parse(fs.readFileSync(args[fromIdx + 1], 'utf8'));
  } else {
    month ??= await latestMonth();
    const url = `https://www.smogon.com/stats/${month}/chaos/${FORMAT}-${cutoff}.json`;
    console.log(`Downloading ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    chaos = await res.json();
  }
  reduced = reduceChaos(chaos);
}

// ---- IDs to names ---------------------------------------------------------------------------------------------
const dex = JSON.parse(fs.readFileSync(DEX, 'utf8'));
const toID = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const moveNames = Object.fromEntries(Object.entries(dex.moves).map(([id, m]) => [id, m.name]));
const itemNames = Object.fromEntries(dex.items.map((i) => [toID(i.name), i.name]));
const abilityNames = Object.fromEntries(Object.keys(dex.abilities).map((a) => [toID(a), a]));
// Matched by ID: Smogon and Showdown don't always agree on punctuation (Sirfetch'd vs Sirfetch’d).
const megaOf = new Map(); // "salamencemega" -> { base: "Salamence", item: "Salamencite" }
for (const s of dex.species) for (const m of s.megas ?? []) megaOf.set(toID(m.name), { base: s.name, item: m.item });
const speciesById = new Map(dex.species.map((s) => [s.id, s.name]));

const named = (rows, names) => rows.map(([id, pct]) => [names[id] ?? id, pct]).filter(([n]) => n);
const skipped = [];
const mons = [];
for (const m of reduced.mons) {
  const mega = megaOf.get(toID(m.name));
  const base = mega?.base ?? speciesById.get(toID(m.name));
  if (!base) { skipped.push(m.name); continue; }
  mons.push({
    ...m,
    species: base,
    mega: mega?.item,
    abilities: named(m.abilities, abilityNames),
    items: named(m.items, itemNames),
    moves: named(m.moves, moveNames),
  });
}

const out = { format: '[Gen 9 Champions] VGC 2026 Reg M-C', month, cutoff: reduced.cutoff, battles: reduced.battles, mons };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${path.relative(root, OUT)}: ${mons.length} Pokémon from ${month} (${reduced.battles} battles, ${reduced.cutoff}+)` +
  (skipped.length ? `; not in the legality data, skipped: ${skipped.join(', ')}` : ''));
