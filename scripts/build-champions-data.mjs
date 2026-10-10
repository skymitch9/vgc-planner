#!/usr/bin/env node
/**
 * Builds src/data/champions-mc.json: what is legal in [Gen 9 Champions] VGC 2026 Reg M-C, decided by Pokémon
 * Showdown's own TeamValidator (species, abilities, items, and every move each species can legally learn).
 *
 * Usage:
 *   node scripts/build-champions-data.mjs [path/to/pokemon-showdown]
 *
 * Without a path, a shallow clone of smogon/pokemon-showdown is made in a temp folder and built there.
 * Re-run when Showdown updates Champions data or a new regulation arrives (change FORMAT below).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'gen9championsvgc2026regmc';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src/data/champions-mc.json');

function showdownDir() {
  const given = process.argv[2];
  if (given) return path.resolve(given);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
  console.log(`Cloning pokemon-showdown into ${dir}...`);
  execFileSync('git', ['clone', '--quiet', '--depth', '1', 'https://github.com/smogon/pokemon-showdown.git', dir], { stdio: 'inherit' });
  execFileSync('npm', ['ci', '--ignore-scripts', '--silent'], { cwd: dir, stdio: 'inherit' });
  execFileSync('node', ['build'], { cwd: dir, stdio: 'inherit' });
  return dir;
}

const ps = showdownDir();
const require = createRequire(path.join(ps, 'package.json'));
const { Dex, TeamValidator } = require('./dist/sim');
const text = (file, key) => require(`./dist/data/text/${file}.js`)[key];
const MovesText = text('moves', 'MovesText');
const AbilitiesText = text('abilities', 'AbilitiesText');
const ItemsText = text('items', 'ItemsText');

const format = Dex.formats.get(FORMAT);
if (!format.exists) throw new Error(`Showdown has no format ${FORMAT}`);
const dex = Dex.forFormat(format);
const validator = TeamValidator.get(format);

/** Champions-specific text wins over the default text. */
const desc = (table, id) => {
  const t = table[id];
  if (!t) return '';
  return t.champions?.shortDesc ?? t.shortDesc ?? t.champions?.desc ?? t.desc ?? '';
};

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const problems = (species, ability, item = '', moves = ['Protect']) =>
  validator.validateSet(
    { name: species, species, ability, item, moves, nature: 'Hardy', evs: { ...ZERO }, ivs: { ...IVS }, level: 50, gender: '' },
    {},
  );

// ---- Species --------------------------------------------------------------------------------------------------
const allMoves = dex.moves.all().filter((m) => !m.isNonstandard || m.isNonstandard === 'Unobtainable');
const usedMoves = new Set();
const usedAbilities = new Set();
const species = [];

for (const s of dex.species.all()) {
  if (s.battleOnly || s.isMega || s.isPrimal || s.forme.includes('Gmax') || s.isNonstandard === 'Past' || s.isNonstandard === 'Future') continue;
  if (s.isCosmeticForme) continue;
  const abilities = [...new Set(Object.values(s.abilities))].filter((a) => {
    const p = problems(s.name, a);
    return !p || !p.some((x) => x.includes(`can't have ${a}`));
  });
  if (!abilities.length) continue;
  if (problems(s.name, abilities[0])) continue; // banned (Restricted, Mythical, not in the game...)

  const moves = allMoves.filter((m) => validator.checkCanLearn(m, s) === null).map((m) => m.id);
  if (!moves.length) continue;
  moves.forEach((m) => usedMoves.add(m));
  abilities.forEach((a) => usedAbilities.add(a));

  // A mega belongs to the forme it changes from (Floette-Mega comes from Floette-Eternal, not Floette).
  const megas = [];
  const seenStones = new Set();
  for (const f of dex.species.all()) {
    if (!f.isMega || !f.requiredItem || dex.species.get(f.changesFrom || f.baseSpecies).id !== s.id) continue;
    if (seenStones.has(f.requiredItem)) continue; // Tatsugiri's cosmetic formes share one stone
    seenStones.add(f.requiredItem);
    const stone = dex.items.get(f.requiredItem);
    if (stone.isNonstandard) continue;
    if (problems(s.name, abilities[0], stone.name)) continue;
    const ability = Object.values(f.abilities)[0];
    usedAbilities.add(ability);
    megas.push({ name: f.name, item: stone.name, types: f.types, baseStats: f.baseStats, ability });
  }

  species.push({
    id: s.id,
    name: s.name,
    num: s.num,
    types: s.types,
    baseStats: s.baseStats,
    abilities,
    gender: s.gender || undefined,
    moves,
    megas: megas.length ? megas : undefined,
  });
}

// ---- Items: legal on at least one species (mega stones only on their own Pokémon) ------------------------------
const megaStones = new Set(species.flatMap((s) => (s.megas ?? []).map((m) => m.item)));
const items = dex.items
  .all()
  .filter((i) => !i.isNonstandard)
  .filter((i) => megaStones.has(i.name) || (!i.megaStone && !problems('Garchomp', 'Rough Skin', i.name)))
  .map((i) => ({ name: i.name, desc: desc(ItemsText, i.id), mega: megaStones.has(i.name) || undefined }));

// ---- Moves and abilities referenced above ---------------------------------------------------------------------
const moves = Object.fromEntries(
  [...usedMoves].sort().map((id) => {
    const m = dex.moves.get(id);
    return [id, {
      name: m.name,
      type: m.type,
      category: m.category,
      bp: m.basePower || undefined,
      acc: m.accuracy === true ? undefined : m.accuracy,
      pp: m.pp,
      priority: m.priority || undefined,
      target: m.target,
      desc: desc(MovesText, m.id),
    }];
  }),
);
const abilities = Object.fromEntries(
  [...usedAbilities].sort().map((name) => [name, desc(AbilitiesText, dex.abilities.get(name).id)]),
);

const natures = dex.natures.all().map((n) => ({ name: n.name, plus: n.plus, minus: n.minus }));

const out = {
  format: format.name,
  generated: new Date().toISOString().slice(0, 10),
  rules: { teamSize: 6, level: 50, itemClause: true, speciesClause: true, maxSpPerStat: 32, maxSpTotal: 66 },
  species: species.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name)),
  items: items.sort((a, b) => a.name.localeCompare(b.name)),
  moves,
  abilities,
  natures,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `Wrote ${path.relative(root, OUT)}: ${species.length} species, ${species.reduce((a, s) => a + (s.megas?.length ?? 0), 0)} megas, ` +
  `${items.length} items, ${usedMoves.size} moves, ${usedAbilities.size} abilities (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`,
);
