/**
 * Speed tiers: the team's real Level 50 Speed next to the format's common threats, with the field effects that
 * change turn order (Tailwind, Trick Room, Choice Scarf, one stage up or down). Pure data in, rows out; no DOM.
 */
import type { Dex, UsageMon } from './dex.ts';
import { spFromSlashes, toID } from './dex.ts';
import { calcStats, emptyStatTable, natureStats, natureWith, statPoints } from './stats.ts';
import type { PokemonSet, StatTable } from './types.ts';

export interface SpeedEntry {
  /** Unique within one list. */
  key: string;
  /** Level 50 Speed with no field effects. */
  speed: number;
  /** Species or form shown, e.g. "Garchomp-Mega-Z". */
  name: string;
  /** What the number assumes, e.g. "Jolly · 32 Spe". */
  spread: string;
  /** A member of the team being edited. */
  mine: boolean;
  /** Most common item is Choice Scarf (threats only). */
  scarf?: boolean;
}

export interface SpeedToggles {
  tailwind: boolean;
  trickRoom: boolean;
  scarf: boolean;
  /** Speed stage for my team: -1, 0 or +1. */
  stage: -1 | 0 | 1;
}

export const NO_TOGGLES: SpeedToggles = { tailwind: false, trickRoom: false, scarf: false, stage: 0 };

export interface SpeedRow extends SpeedEntry {
  /** Speed after the toggles. */
  effective: number;
  /** Same effective Speed as the row above or below it. */
  tie: boolean;
}

/** Stat stage multiplier, rounded down like the games: +1 is x3/2, -1 is x2/3. */
export function applyStage(speed: number, stage: number): number {
  return stage >= 0 ? Math.floor((speed * (2 + stage)) / 2) : Math.floor((speed * 2) / (2 - stage));
}

/** Speed after the toggles: stage first, then Tailwind (x2) for my team, Choice Scarf (x1.5) for Scarf threats. */
export function effectiveSpeed(entry: SpeedEntry, t: SpeedToggles): number {
  if (entry.mine) {
    const staged = applyStage(entry.speed, t.stage);
    return t.tailwind ? staged * 2 : staged;
  }
  return t.scarf && entry.scarf ? Math.floor((entry.speed * 3) / 2) : entry.speed;
}

/** One list in turn order: fastest first, or slowest first under Trick Room. Equal Speeds are marked as ties. */
export function speedTiers(entries: readonly SpeedEntry[], t: SpeedToggles): SpeedRow[] {
  const rows = entries.map((e) => ({ ...e, effective: effectiveSpeed(e, t), tie: false }));
  const dir = t.trickRoom ? 1 : -1;
  // Within a tie, team members first, then the original order.
  rows.sort((a, b) => dir * (a.effective - b.effective) || Number(b.mine) - Number(a.mine));
  for (let i = 0; i < rows.length; i++) {
    rows[i]!.tie = rows[i - 1]?.effective === rows[i]!.effective || rows[i + 1]?.effective === rows[i]!.effective;
  }
  return rows;
}

export interface Matchup { outspeeds: number; ties: number; slower: number }

/** How one team member fares against every listed threat, in the current turn order (Trick Room aware). */
export function matchup(rows: readonly SpeedRow[], key: string, t: SpeedToggles): Matchup {
  const me = rows.find((r) => r.key === key);
  const out: Matchup = { outspeeds: 0, ties: 0, slower: 0 };
  if (!me) return out;
  for (const r of rows) {
    if (r.mine) continue;
    const diff = t.trickRoom ? r.effective - me.effective : me.effective - r.effective;
    if (diff > 0) out.outspeeds++;
    else if (diff === 0) out.ties++;
    else out.slower++;
  }
  return out;
}

const speOf = (base: StatTable, sp: StatTable, nature: string): number => calcStats(base, sp, nature).spe;

/** "Jolly · 32 Spe", "Quiet · 0 Spe". */
const spreadLabel = (nature: string, sp: number): string => `${nature || 'Neutral'} · ${sp} Spe`;

/** Every team member at its paste's Speed, plus its Mega form's Speed when it holds its Mega Stone. */
export function teamEntries(team: readonly PokemonSet[], dex: Dex): SpeedEntry[] {
  const out: SpeedEntry[] = [];
  team.forEach((set, i) => {
    const species = dex.species(set.species);
    if (!species) return;
    const sp = statPoints(set)?.sp ?? emptyStatTable();
    const nature = cap(set.nature.trim());
    const label = spreadLabel(natureStats(nature) ? nature : '', sp.spe);
    const name = set.nickname && set.nickname !== set.species ? `${species.name} (${set.nickname})` : species.name;
    out.push({ key: `team-${i}`, speed: speOf(species.baseStats, sp, nature), name, spread: label, mine: true });
    const mega = set.item ? dex.megaFor(species, set.item) : null;
    if (mega) out.push({ key: `team-${i}-mega`, speed: speOf(mega.baseStats, sp, nature), name: mega.name, spread: label, mine: true });
  });
  return out;
}

/** calcStats wants the nature's canonical capitalisation ("jolly" -> "Jolly"). */
const cap = (n: string): string => (n ? n[0]!.toUpperCase() + n.slice(1).toLowerCase() : '');

/**
 * The format's common threats from the usage data: for each of the `limit` most used entries (Megas are their own
 * entries), the Speed of its most common spread, plus the max-Speed benchmark (+Spe nature, 32 Spe) if different.
 */
export function threatEntries(dex: Dex, limit = 40): SpeedEntry[] {
  const out: SpeedEntry[] = [];
  for (const mon of (dex.usage?.mons ?? []).slice(0, limit)) {
    const base = baseFor(mon, dex);
    if (!base) continue;
    const scarf = toID(mon.items[0]?.[0]) === 'choicescarf';
    const top = mon.spreads[0];
    let common = -1;
    if (top) {
      const sp = spFromSlashes(top[1]);
      common = speOf(base, sp, top[0]);
      out.push({ key: `threat-${mon.name}`, speed: common, name: mon.name, spread: `${spreadLabel(top[0], sp.spe)} (most common)`, mine: false, scarf });
    }
    const max = speOf(base, { ...emptyStatTable(), spe: 32 }, natureWith('spe', 'atk')!);
    if (max !== common) out.push({ key: `threat-${mon.name}-max`, speed: max, name: mon.name, spread: '+Spe · 32 Spe (max)', mine: false, scarf });
  }
  return out;
}

/** Base stats for a usage entry: the Mega forme's when the entry is a Mega. */
function baseFor(mon: UsageMon, dex: Dex): StatTable | null {
  const species = dex.species(mon.species);
  if (!species) return null;
  if (!mon.mega) return species.baseStats;
  return dex.megaFor(species, mon.mega)?.baseStats ?? null;
}

/*
 * The meta speed list: a view added beside the tiers above, which it leaves untouched. Each of the format's most used
 * Pokémon at three benchmarks (0 Spe neutral, 32 Spe neutral, 32 Spe +Spe nature) with its usage, and the team mixed
 * in at its real Speed. The opponent toggles apply to every listed opponent.
 */

/** Opponent-side effects: Icy Wind (one stage down), paralysis (x1/2), Choice Scarf (x3/2) on every opponent. */
export interface FoeToggles {
  icyWind: boolean;
  paralyzed: boolean;
  scarf: boolean;
}

export const NO_FOE_TOGGLES: FoeToggles = { icyWind: false, paralyzed: false, scarf: false };

/** One of the format's most used Pokémon at the three benchmark spreads. */
export interface MetaEntry {
  key: string;
  name: string;
  /** Percent of teams. */
  usage: number;
  /** 0 Spe, neutral nature. */
  min: number;
  /** 32 Spe, neutral nature. */
  max: number;
  /** 32 Spe, +Spe nature. */
  maxPlus: number;
  /** Its most common spread in the usage data, when there is one. */
  common: { speed: number; spread: string } | null;
  /** Most common item is Choice Scarf. */
  scarf: boolean;
}

export interface MetaRow {
  key: string;
  name: string;
  mine: boolean;
  /** Percent of teams; null for team members. */
  usage: number | null;
  scarf: boolean;
  /** After the toggles. A team member has one Speed, so all three are equal. */
  min: number;
  max: number;
  maxPlus: number;
  /** The most common spread after the toggles (opponents only). */
  common: { speed: number; spread: string } | null;
  /** What a team member's number assumes; empty for opponents. */
  spread: string;
}

/** The `limit` most used entries (Megas are their own entries) at Min, Max and Max Nature+. */
export function metaEntries(dex: Dex, limit = 60): MetaEntry[] {
  const out: MetaEntry[] = [];
  const plus = natureWith('spe', 'atk')!;
  for (const mon of (dex.usage?.mons ?? []).slice(0, limit)) {
    const base = baseFor(mon, dex);
    if (!base) continue;
    const at = (spe: number, nature: string): number => speOf(base, { ...emptyStatTable(), spe }, nature);
    const top = mon.spreads[0];
    const sp = top ? spFromSlashes(top[1]) : null;
    out.push({
      key: `meta-${mon.name}`,
      name: mon.name,
      usage: mon.usage,
      min: at(0, ''),
      max: at(32, ''),
      maxPlus: at(32, plus),
      common: top && sp ? { speed: speOf(base, sp, top[0]), spread: spreadLabel(top[0], sp.spe) } : null,
      scarf: toID(mon.items[0]?.[0]) === 'choicescarf',
    });
  }
  return out;
}

/**
 * An opponent's Speed after the opponent toggles: Icy Wind's stage first, then Choice Scarf, then paralysis, each
 * rounded down. `scarf` adds the Scarf for this one opponent (the tiers' "Scarf threats" toggle).
 */
export function foeSpeed(speed: number, f: FoeToggles, scarf = false): number {
  const staged = f.icyWind ? applyStage(speed, -1) : speed;
  const scarfed = f.scarf || scarf ? Math.floor((staged * 3) / 2) : staged;
  return f.paralyzed ? Math.floor(scarfed / 2) : scarfed;
}

/**
 * The meta list in turn order: opponents placed by Max Nature+ (their fastest), or by Min under Trick Room (slowest
 * first); team members at their Speed after my toggles. On an equal placing team members come first.
 */
export function metaSpeedList(team: readonly SpeedEntry[], meta: readonly MetaEntry[], t: SpeedToggles, f: FoeToggles): MetaRow[] {
  const rows: { row: MetaRow; order: number }[] = [];
  for (const e of team) {
    const s = effectiveSpeed(e, t);
    rows.push({ row: { key: e.key, name: e.name, mine: true, usage: null, scarf: false, min: s, max: s, maxPlus: s, common: null, spread: e.spread }, order: s });
  }
  for (const m of meta) {
    const fs = (n: number): number => foeSpeed(n, f, t.scarf && m.scarf);
    const row: MetaRow = {
      key: m.key, name: m.name, mine: false, usage: m.usage, scarf: m.scarf, min: fs(m.min), max: fs(m.max), maxPlus: fs(m.maxPlus),
      common: m.common ? { speed: fs(m.common.speed), spread: m.common.spread } : null, spread: '',
    };
    rows.push({ row, order: t.trickRoom ? row.min : row.maxPlus });
  }
  const dir = t.trickRoom ? 1 : -1;
  rows.sort((a, b) => dir * (a.order - b.order) || Number(b.row.mine) - Number(a.row.mine));
  return rows.map((r) => r.row);
}

/** Opponents whose name contains the query (case and punctuation ignored); team members always stay. */
export function filterMeta(rows: readonly MetaRow[], query: string): MetaRow[] {
  const q = toID(query);
  return q ? rows.filter((r) => r.mine || toID(r.name).includes(q)) : [...rows];
}

export interface MetaMatchup { min: number; max: number; maxPlus: number; of: number }

/** How many listed opponents a team member strictly beats at each benchmark (moves before, under Trick Room). */
export function metaMatchup(rows: readonly MetaRow[], key: string, trickRoom: boolean): MetaMatchup {
  const me = rows.find((r) => r.key === key && r.mine);
  const out: MetaMatchup = { min: 0, max: 0, maxPlus: 0, of: 0 };
  if (!me) return out;
  const beats = (s: number): boolean => (trickRoom ? me.min < s : me.min > s);
  for (const r of rows) {
    if (r.mine) continue;
    out.of++;
    if (beats(r.min)) out.min++;
    if (beats(r.max)) out.max++;
    if (beats(r.maxPlus)) out.maxPlus++;
  }
  return out;
}
