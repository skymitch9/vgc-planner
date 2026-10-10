/**
 * What is legal in the current regulation and what people actually play, as plain data plus lookups.
 *
 * Both datasets are generated, never edited by hand:
 * - `src/data/champions-mc.json` (`npm run champions-data`): Pokémon Showdown's own TeamValidator decided every
 *   species, ability, item and learnable move for [Gen 9 Champions] VGC 2026 Reg M-C.
 * - `src/data/usage-mc.json` (`npm run usage`): Smogon's monthly usage stats for the same format.
 *
 * No DOM here, so the same checks can run on a server.
 */
import { STAT_KEYS, readSpread, statPoints } from './stats.ts';
import type { PokemonSet, StatKey, StatTable } from './types.ts';

export interface DexMega { name: string; item: string; types: string[]; baseStats: StatTable; ability: string }
export interface DexSpecies {
  id: string;
  name: string;
  num: number;
  types: string[];
  baseStats: StatTable;
  abilities: string[];
  gender?: string;
  /** Move IDs this species can legally have. */
  moves: string[];
  megas?: DexMega[];
}
export interface DexMove {
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  bp?: number;
  acc?: number;
  pp: number;
  priority?: number;
  target: string;
  desc: string;
}
export interface DexItem { name: string; desc: string; mega?: true }
export interface DexNature { name: string; plus?: StatKey; minus?: StatKey }
export interface DexData {
  format: string;
  generated: string;
  rules: { teamSize: number; level: number; maxSpPerStat: number; maxSpTotal: number };
  species: DexSpecies[];
  items: DexItem[];
  moves: Record<string, DexMove>;
  abilities: Record<string, string>;
  natures: DexNature[];
}

/** [name, percent of this Pokémon's games]. */
export type Share = [string, number];
export interface UsageMon {
  /** Smogon's name, e.g. "Salamence-Mega". */
  name: string;
  /** The species you'd put in a paste ("Salamence"). */
  species: string;
  /** The Mega Stone when `name` is a Mega. */
  mega?: string;
  /** Percent of teams. */
  usage: number;
  abilities: Share[];
  items: Share[];
  moves: Share[];
  /** [nature, "hp/atk/def/spa/spd/spe" Stat Points, percent]. */
  spreads: [string, string, number][];
  mates: Share[];
}
export interface UsageData { format: string; month: string; cutoff: number; battles: number; mons: UsageMon[] }

export const toID = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export class Dex {
  readonly data: DexData;
  readonly usage: UsageData | null;
  private readonly speciesById = new Map<string, DexSpecies>();
  private readonly megaById = new Map<string, { species: DexSpecies; mega: DexMega }>();
  private readonly itemById = new Map<string, DexItem>();
  private readonly abilityById = new Map<string, string>();
  private readonly natureById = new Map<string, DexNature>();
  private readonly usageBySpecies = new Map<string, UsageMon[]>();
  private readonly moveSets = new Map<string, Set<string>>();
  private readonly movesUsed = new Map<string, Map<string, number>>();

  constructor(data: DexData, usage: UsageData | null = null) {
    this.data = data;
    this.usage = usage;
    for (const s of data.species) {
      this.speciesById.set(s.id, s);
      this.moveSets.set(s.id, new Set(s.moves));
      for (const m of s.megas ?? []) this.megaById.set(toID(m.name), { species: s, mega: m });
    }
    for (const i of data.items) this.itemById.set(toID(i.name), i);
    for (const a of Object.keys(data.abilities)) this.abilityById.set(toID(a), a);
    for (const n of data.natures) this.natureById.set(toID(n.name), n);
    for (const u of usage?.mons ?? []) {
      const id = toID(u.species);
      this.usageBySpecies.set(id, [...(this.usageBySpecies.get(id) ?? []), u]);
    }
  }

  /** A species by any spelling. A Mega name ("Garchomp-Mega-Z") resolves to its base species. */
  species(name: string): DexSpecies | null {
    const id = toID(name);
    return this.speciesById.get(id) ?? this.megaById.get(id)?.species ?? null;
  }

  move(name: string): DexMove | null { return this.data.moves[toID(name)] ?? null; }
  item(name: string): DexItem | null { return this.itemById.get(toID(name)) ?? null; }
  ability(name: string): string | null { return this.abilityById.get(toID(name)) ?? null; }
  nature(name: string): DexNature | null { return this.natureById.get(toID(name)) ?? null; }

  canLearn(species: DexSpecies, move: string): boolean { return this.moveSets.get(species.id)?.has(toID(move)) ?? false; }

  /** The Mega this species becomes holding `item`, if any. */
  megaFor(species: DexSpecies, item: string): DexMega | null {
    return species.megas?.find((m) => toID(m.item) === toID(item)) ?? null;
  }

  /** Everything this species may hold: every general item plus its own Mega Stones. */
  legalItems(species: DexSpecies | null): DexItem[] {
    const own = new Set((species?.megas ?? []).map((m) => toID(m.item)));
    return this.data.items.filter((i) => !i.mega || own.has(toID(i.name)));
  }

  legalMoves(species: DexSpecies): DexMove[] {
    return species.moves.map((id) => this.data.moves[id]).filter((m): m is DexMove => !!m);
  }

  /** Usage entries for a species: the base form and each Mega that comes from it, most used first. */
  usageFor(species: DexSpecies | null): UsageMon[] {
    return species ? [...(this.usageBySpecies.get(species.id) ?? [])].sort((a, b) => b.usage - a.usage) : [];
  }

  /** Percent of games a move is used on this species (across its forms), for sorting pickers. */
  moveUsage(species: DexSpecies): Map<string, number> {
    let table = this.movesUsed.get(species.id);
    if (!table) {
      table = new Map();
      for (const u of this.usageFor(species)) for (const [m, pct] of u.moves) table.set(toID(m), Math.max(table.get(toID(m)) ?? 0, pct));
      this.movesUsed.set(species.id, table);
    }
    return table;
  }

  /** Every species with usage first (most used first), then the rest by Dex number. */
  speciesByUsage(): DexSpecies[] {
    const usage = new Map<string, number>();
    for (const u of this.usage?.mons ?? []) usage.set(toID(u.species), (usage.get(toID(u.species)) ?? 0) + u.usage);
    return [...this.data.species].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.num - b.num);
  }

  speciesUsage(species: DexSpecies): number {
    return this.usageFor(species).reduce((a, u) => a + u.usage, 0);
  }
}

// ---- Legality -------------------------------------------------------------------------------------------------

/** Rule problems with one Pokémon. Empty means legal in the regulation. */
export function setProblems(set: PokemonSet, dex: Dex): string[] {
  const out: string[] = [];
  const label = set.nickname || set.species || 'A Pokémon';
  const species = dex.species(set.species);
  if (!species) return [`${label}: ${set.species || 'its species'} isn't allowed in ${dex.data.format.replace(/^\[[^\]]+\]\s*/, '')}.`];

  // "Garchomp-Mega @ Garchompite" is accepted as well as the usual "Garchomp @ Garchompite".
  const pastedMega = species.megas?.find((m) => toID(m.name) === toID(set.species)) ?? null;
  if (set.item) {
    const item = dex.item(set.item);
    if (!item) out.push(`${label}: ${set.item} isn't an allowed item.`);
    else if (item.mega && !dex.megaFor(species, item.name)) out.push(`${label}: ${item.name} only works on its own Pokémon.`);
  }
  if (pastedMega && toID(set.item) !== toID(pastedMega.item)) out.push(`${label}: ${pastedMega.name} needs ${pastedMega.item}.`);

  if (set.ability) {
    const ok = species.abilities.some((a) => toID(a) === toID(set.ability)) || (pastedMega && toID(pastedMega.ability) === toID(set.ability));
    if (!ok) out.push(`${label}: ${species.name} can't have ${set.ability}.`);
  }
  if (set.nature && !dex.nature(set.nature)) out.push(`${label}: ${set.nature} isn't a nature.`);

  const seen = new Set<string>();
  for (const move of set.moves) {
    const id = toID(move);
    if (!dex.move(move)) out.push(`${label}: ${move} isn't an allowed move.`);
    else if (!dex.canLearn(species, move)) out.push(`${label}: ${species.name} can't learn ${dex.move(move)?.name ?? move}.`);
    if (seen.has(id)) out.push(`${label}: ${move} is listed twice.`);
    seen.add(id);
  }
  if (set.moves.length > 4) out.push(`${label}: ${set.moves.length} moves; the limit is 4.`);
  if (!set.moves.length) out.push(`${label}: no moves.`);

  // Real EVs (numbers above 32) are converted to Stat Points first, the same way the simulation reads them.
  const reading = statPoints(set);
  if (reading) {
    const total = STAT_KEYS.reduce((a, k) => a + reading.sp[k], 0);
    const { maxSpTotal } = dex.data.rules;
    if (total > maxSpTotal) out.push(`${label}: ${total} Stat Points${reading.converted ? ' (from EVs)' : ''}; the limit is ${maxSpTotal}.`);
  }
  return out;
}

/** Team-wide rules: size, Species Clause (one of each Dex number) and Item Clause (no duplicate items). */
export function teamProblems(sets: readonly PokemonSet[], dex: Dex): string[] {
  const out: string[] = [];
  const { teamSize } = dex.data.rules;
  if (sets.length > teamSize) out.push(`The team has ${sets.length} Pokémon; the limit is ${teamSize}.`);
  const byNum = new Map<number, string[]>();
  const byItem = new Map<string, string[]>();
  for (const s of sets) {
    const sp = dex.species(s.species);
    if (sp) byNum.set(sp.num, [...(byNum.get(sp.num) ?? []), s.species]);
    if (s.item) byItem.set(toID(s.item), [...(byItem.get(toID(s.item)) ?? []), s.species]);
  }
  for (const names of byNum.values()) if (names.length > 1) out.push(`Species Clause: ${names.join(' and ')} count as the same Pokémon.`);
  for (const [id, names] of byItem) if (names.length > 1) out.push(`Item Clause: ${dex.item(id)?.name ?? id} is held by ${names.join(' and ')}.`);
  return out;
}

// ---- Writing pastes and building sets -------------------------------------------------------------------------

export const emptySet = (species = ''): PokemonSet => ({
  nickname: '', species, gender: '', item: '', ability: '', level: null, nature: '', evs: '', ivs: '', moves: [], extra: [],
});

const SP_LABEL: Record<StatKey, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/** "32/32/0/0/2/0" or a table -> "32 HP / 32 Atk / 2 SpD". */
export function spreadLine(sp: StatTable | string): string {
  const table = typeof sp === 'string' ? spFromSlashes(sp) : sp;
  return STAT_KEYS.filter((k) => table[k] > 0).map((k) => `${table[k]} ${SP_LABEL[k]}`).join(' / ');
}

export function spFromSlashes(text: string): StatTable {
  const n = text.split('/').map((v) => Number(v) || 0);
  return { hp: n[0] ?? 0, atk: n[1] ?? 0, def: n[2] ?? 0, spa: n[3] ?? 0, spd: n[4] ?? 0, spe: n[5] ?? 0 };
}

/** Writes one Pokémon in Showdown format. Lines the parser didn't recognise (Tera Type, Shiny...) are kept. */
export function writeSet(set: PokemonSet): string {
  let head = set.nickname && set.nickname !== set.species ? `${set.nickname} (${set.species})` : set.species;
  if (set.gender) head += ` (${set.gender})`;
  if (set.item) head += ` @ ${set.item}`;
  const lines = [head];
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.level !== null && set.level !== undefined) lines.push(`Level: ${set.level}`);
  lines.push(...set.extra);
  if (set.evs) lines.push(`EVs: ${set.evs}`);
  if (set.nature) lines.push(`${set.nature} Nature`);
  if (set.ivs) lines.push(`IVs: ${set.ivs}`);
  for (const m of set.moves) lines.push(`- ${m}`);
  return lines.join('\n');
}

export const writeTeam = (sets: readonly PokemonSet[]): string => sets.map(writeSet).join('\n\n') + (sets.length ? '\n' : '');

/**
 * The most common build for a usage entry: its top item (or Mega Stone), ability, four most used moves, and the
 * chosen spread (most common by default). A Mega is written as its base species holding the stone, the way the
 * game and this app's simulator expect it.
 */
export function setFromUsage(mon: UsageMon, dex: Dex, spreadIndex = 0): PokemonSet {
  const species = dex.species(mon.species);
  const set = emptySet(species?.name ?? mon.species);
  set.item = mon.mega ?? mon.items[0]?.[0] ?? '';
  // A Mega's usage lists the Mega's ability; the paste needs one its base form can have.
  const usedAbility = mon.abilities.find(([a]) => species?.abilities.some((b) => toID(b) === toID(a)))?.[0];
  set.ability = usedAbility ?? species?.abilities[0] ?? '';
  set.moves = mon.moves
    .map(([m]) => m)
    .filter((m) => !species || dex.canLearn(species, m))
    .slice(0, 4);
  const spread = mon.spreads[spreadIndex] ?? mon.spreads[0];
  if (spread) {
    set.nature = spread[0];
    set.evs = spreadLine(spread[1]);
  }
  set.level = 50;
  return set;
}

/** The Stat Points of a set as a table (Champions pastes put them on the EVs line). */
export const spOf = (set: PokemonSet): StatTable => readSpread(set.evs);
