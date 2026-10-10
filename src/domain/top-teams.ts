/**
 * "Top teams": six-Pokémon cores derived from Smogon's teammate data.
 *
 * Smogon's monthly stats don't list whole teams, only how often each Pokémon appears beside each other one. So these
 * are built, not observed: start from a popular Pokémon and keep adding whichever legal Pokémon is most often seen
 * with the ones already chosen. The UI says so wherever they're shown.
 *
 * No DOM here.
 */
import type { Dex, UsageMon } from './dex.ts';
import { setFromUsage, setProblems, toID } from './dex.ts';
import type { PokemonSet } from './types.ts';

export interface TopTeam {
  /** Stable: the six names, in order, as an ID. */
  id: string;
  /** The two most used members, "Rillaboom / Incineroar". */
  name: string;
  /** Exactly six, most used first. */
  members: UsageMon[];
  /** Sum of both-way teammate percentages over all 15 pairs. */
  score: number;
}

const SEEDS = 40;
const SIZE = 6;
/**
 * Pokémon on fewer than this percent of teams are left out. Their teammate lists come from a handful of games, so
 * "always seen with Pelipper" on a 0.3% Pokémon would outweigh real, common cores.
 */
const MIN_USAGE = 1;

/** How often `b` is on `a`'s teams (percent), by Smogon name; 0 when not listed. */
type MateTable = (a: UsageMon, b: UsageMon) => number;

function mateTable(mons: readonly UsageMon[]): MateTable {
  const maps = new Map<string, Map<string, number>>();
  for (const m of mons) maps.set(m.name, new Map(m.mates));
  return (a, b) => maps.get(a.name)?.get(b.name) ?? 0;
}

const byUsage = (a: UsageMon, b: UsageMon): number => b.usage - a.usage;

/**
 * Up to `count` six-Pokémon cores, best synergy first. Deterministic for the same data. Every team is legal: each
 * member's most common build passes `setProblems`, and no two share a Dex number (Species Clause).
 */
export function buildTopTeams(dex: Dex, count = 25): TopTeam[] {
  const usage = dex.usage;
  if (!usage) return [];
  const pool = usage.mons.filter((m) => m.usage >= MIN_USAGE && setProblems(setFromUsage(m, dex), dex).length === 0).sort(byUsage);
  const mate = mateTable(pool);
  const pair = (a: UsageMon, b: UsageMon): number => mate(a, b) + mate(b, a);
  const num = new Map(pool.map((m) => [m.name, dex.species(m.species)?.num ?? -1]));

  const teams: TopTeam[] = [];
  for (const seed of pool.slice(0, SEEDS)) {
    const members = [seed];
    while (members.length < SIZE) {
      const used = new Set(members.map((m) => num.get(m.name)));
      let best: UsageMon | null = null;
      let bestScore = -1;
      // `pool` is in usage order, so a strict `>` keeps the more used candidate on ties (and when everything is 0).
      for (const c of pool) {
        if (used.has(num.get(c.name))) continue;
        const s = members.reduce((a, m) => a + pair(m, c), 0);
        if (s > bestScore) { best = c; bestScore = s; }
      }
      if (!best) break;
      members.push(best);
    }
    if (members.length < SIZE) continue;
    members.sort(byUsage);
    let score = 0;
    for (let i = 0; i < SIZE; i++) for (let j = i + 1; j < SIZE; j++) score += pair(members[i]!, members[j]!);
    teams.push({
      id: toID(members.map((m) => m.name).join('-')),
      name: `${members[0]!.name} / ${members[1]!.name}`,
      members,
      score: Math.round(score * 10) / 10,
    });
  }

  teams.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const kept: TopTeam[] = [];
  for (const t of teams) {
    const names = new Set(t.members.map((m) => m.name));
    const near = kept.some((k) => k.members.filter((m) => names.has(m.name)).length >= SIZE - 1);
    if (!near) kept.push(t);
    if (kept.length >= count) break;
  }
  return kept;
}

/**
 * Item Clause: when `set`'s item is already in `taken` (item IDs), switch it to the next most used item for this
 * Pokémon that isn't taken and is allowed. A Mega keeps its stone. Changes `set` in place and returns it.
 */
export function avoidTakenItem(set: PokemonSet, mon: UsageMon, dex: Dex, taken: ReadonlySet<string>): PokemonSet {
  if (mon.mega || !taken.has(toID(set.item))) return set;
  set.item = mon.items.map(([n]) => n).find((n) => !taken.has(toID(n)) && dex.item(n)) ?? '';
  return set;
}

/**
 * The team as pastes-ready sets: each member's most common build (or the spread chosen in `spreads`, by Smogon
 * name), with later members falling back to another item where an earlier one already holds theirs.
 */
export function topTeamSets(team: TopTeam, dex: Dex, spreads: Record<string, number> = {}): PokemonSet[] {
  const taken = new Set<string>();
  return team.members.map((m) => {
    const set = avoidTakenItem(setFromUsage(m, dex, spreads[m.name] ?? 0), m, dex, taken);
    if (set.item) taken.add(toID(set.item));
    return set;
  });
}
