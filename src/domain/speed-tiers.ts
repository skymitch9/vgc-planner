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
