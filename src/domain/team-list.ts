/**
 * The official two-page team list handed in at in-person tournaments, filled in from a team's paste plus the
 * player's own details. Pure: the details are read and cleaned here, kept by `infra/player-details.ts` under their
 * own storage key, and drawn by `ui/team-list-pages.ts`.
 *
 * The player details are personal data. They are never part of the library, so they never reach an export, a share,
 * the account sync or a server.
 */
import { REGULATION } from './regulation.ts';
import { baseSpecies } from './showdown.ts';
import { emptyStatTable, statPoints } from './stats.ts';
import type { PokemonSet, StatTable } from './types.ts';

export const AGE_DIVISIONS = ['Juniors', 'Seniors', 'Masters'] as const;
export type AgeDivision = (typeof AGE_DIVISIONS)[number];

/** The player block of page 1 of the form, in its order. */
export interface PlayerDetails {
  playerName: string;
  ageDivision: AgeDivision | '';
  trainerName: string;
  playerId: string;
  dobMonth: string;
  dobDay: string;
  dobYear: string;
  switchProfile: string;
  supportId: string;
}

/** What is saved on this device: the details, and the last Battle Team Number / Name typed per team id. */
export interface PlayerDetailsFile {
  details: PlayerDetails;
  battleTeams: Record<string, string>;
}

/** Caps for what is kept; the form's lines are short. */
export const DETAILS_LIMITS = { text: 80, battleTeams: 200 } as const;

const TEXT_FIELDS = ['playerName', 'trainerName', 'playerId', 'dobMonth', 'dobDay', 'dobYear', 'switchProfile', 'supportId'] as const;

export const emptyDetails = (): PlayerDetails => ({
  playerName: '', ageDivision: '', trainerName: '', playerId: '', dobMonth: '', dobDay: '', dobYear: '', switchProfile: '', supportId: '',
});

export const emptyDetailsFile = (): PlayerDetailsFile => ({ details: emptyDetails(), battleTeams: {} });

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, DETAILS_LIMITS.text) : '');

/** Reads saved details, keeping only known fields as short strings; anything unreadable becomes empty. */
export function readDetailsFile(raw: unknown): PlayerDetailsFile {
  const file = emptyDetailsFile();
  if (typeof raw !== 'object' || raw === null) return file;
  const r = raw as Record<string, unknown>;
  const d = typeof r.details === 'object' && r.details !== null ? (r.details as Record<string, unknown>) : {};
  for (const k of TEXT_FIELDS) file.details[k] = cleanText(d[k]);
  if ((AGE_DIVISIONS as readonly unknown[]).includes(d.ageDivision)) file.details.ageDivision = d.ageDivision as AgeDivision;
  if (typeof r.battleTeams === 'object' && r.battleTeams !== null) {
    for (const [id, name] of Object.entries(r.battleTeams as Record<string, unknown>).slice(0, DETAILS_LIMITS.battleTeams)) {
      if (typeof name === 'string' && id.length <= 100) file.battleTeams[id] = cleanText(name);
    }
  }
  return file;
}

/** The Battle Team Number / Name for a team: what was last typed for it, else the team's name. */
export const battleTeamFor = (file: PlayerDetailsFile, teamId: string, teamName: string): string =>
  Object.prototype.hasOwnProperty.call(file.battleTeams, teamId) ? file.battleTeams[teamId]! : cleanText(teamName);

/** One Pokémon box of the form. */
export interface TeamListMon {
  pokemon: string;
  statAlignment: string;
  ability: string;
  heldItem: string;
  moves: [string, string, string, string];
  /** Stat Points, page 1 only; a stat the paste leaves out is 0. */
  stats: StatTable;
}

/**
 * The six boxes, in paste order. The Pokémon line is the species as the game's Battle Team shows it: a Mega prints as
 * its base form (the stone is the held item). Missing Pokémon are null, so their boxes print empty.
 */
export function teamListMons(sets: readonly PokemonSet[]): (TeamListMon | null)[] {
  return Array.from({ length: REGULATION.teamSize }, (_, i) => {
    const s = sets[i];
    if (!s || !s.species) return null;
    const moves = [0, 1, 2, 3].map((j) => s.moves[j] ?? '') as TeamListMon['moves'];
    return {
      pokemon: baseSpecies(s.species),
      statAlignment: s.nature ?? '',
      ability: s.ability ?? '',
      heldItem: s.item ?? '',
      moves,
      stats: statPoints(s)?.sp ?? emptyStatTable(),
    };
  });
}
