/**
 * Top players' teams for the current regulation, as plain data plus helpers to turn one into pasteable sets.
 *
 * The data is generated, never edited by hand: `src/data/teams-mc.json` (`npm run teams`, scripts/fetch-teams.mjs)
 * from Limitless VGC (official events), crob.at (community online tournaments) and Victory Road (replica codes).
 * Most sources publish no spreads; `teamSets` fills those from Smogon usage and says which ones it filled.
 *
 * No DOM here.
 */
import { emptySet, spreadLine, toID, type Dex, type UsageData, type UsageMon } from './dex.ts';
import type { PokemonSet } from './types.ts';

export type TeamSource = 'limitless' | 'crob' | 'victoryroad';
export type Tier = 'worlds' | 'international' | 'regional' | 'special' | 'online' | 'ranked';

/** Best first: the order teams are sorted in. */
export const TIERS: readonly Tier[] = ['worlds', 'international', 'regional', 'special', 'online', 'ranked'] as const;

export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  worlds: 'World Championships',
  international: 'International Championships',
  regional: 'Regional Championships',
  special: 'Special Event',
  online: 'Online tournament',
  ranked: 'Ranked Battles',
};

export interface TournamentSet {
  species: string;
  /** Empty when the source didn't say (Victory Road rows without a paste only name the Pokémon and its Mega). */
  item: string;
  ability: string;
  nature: string;
  moves: string[];
  /** Stat Points line ("32 HP / 2 Def / 32 Spe"), only when the player published a spread. */
  evs?: string;
}

export interface TournamentTeam {
  /** Stable: source plus the source's own id ("limitless-7178", "crob-tq7KCk", "victoryroad-9NNN3N8A4G"). */
  id: string;
  source: TeamSource;
  event: string;
  eventUrl?: string;
  /** YYYY-MM-DD. */
  date: string;
  tier: Tier;
  /** 1 for a win; for a "Top 8" finish the cut it reached (8). Null when unknown (ranked teams without a rank). */
  placing: number | null;
  fieldSize?: number;
  player: string;
  /** ISO 3166 alpha-3, when the source shows a flag. */
  country?: string;
  /** Where the team was found. */
  sourceUrl: string;
  /** The in-game rental (replica) codes, when published. */
  replicaCodes?: string[];
  /** False when only the six Pokémon (and their Megas) are known. */
  setsKnown: boolean;
  sets: TournamentSet[];
}

export interface TeamSourceInfo {
  id: TeamSource;
  label: string;
  url: string;
  /** ISO timestamp of the refresh. */
  fetched: string;
  /** Teams in `teams` from this source. */
  teams: number;
  /** Victory Road rows whose codes were attached to a team from another source instead. */
  merged?: number;
}

export interface TopTeamsData {
  format: string;
  generated: string;
  sources: TeamSourceInfo[];
  teams: TournamentTeam[];
}

/** Usage entries for a species, the most used first. */
function usageFor(speciesId: string, usage: UsageData | null | undefined): UsageMon[] {
  return (usage?.mons ?? []).filter((m) => toID(m.species) === speciesId).sort((a, b) => b.usage - a.usage);
}

/**
 * The team as level 50 `PokemonSet`s. A set without a published spread gets the most used Smogon spread for that
 * species (for its Mega when it holds the stone), preferring one with the player's nature; the player's nature is
 * always kept. Those species are listed in `estimated` so the UI can say "spread estimated from usage". With no
 * usage entry the spread stays empty.
 */
export function teamSets(team: TournamentTeam, dex: Dex, usage?: UsageData | null): { sets: PokemonSet[]; estimated: string[] } {
  const stats = usage ?? dex.usage;
  const estimated: string[] = [];
  const sets = team.sets.map((t) => {
    const set = emptySet(t.species);
    set.item = t.item;
    set.ability = t.ability;
    set.nature = t.nature;
    set.moves = [...t.moves];
    set.level = 50;
    if (t.evs) {
      set.evs = t.evs;
      return set;
    }
    const species = dex.species(t.species);
    const mons = species ? usageFor(species.id, stats) : [];
    const mon = mons.find((m) => !!t.item && toID(m.mega) === toID(t.item)) ?? mons.find((m) => !m.mega) ?? mons[0];
    const spread = mon && (mon.spreads.find(([nature]) => !!t.nature && toID(nature) === toID(t.nature)) ?? mon.spreads[0]);
    if (spread) {
      set.nature ||= spread[0];
      set.evs = spreadLine(spread[1]);
      estimated.push(t.species);
    }
    return set;
  });
  return { sets, estimated };
}
