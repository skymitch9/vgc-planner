/** The teams of the library as choices for "Use a saved team…": planning against a team you already saved. */
import { parseShowdown } from './showdown.ts';
import type { Library } from './types.ts';

export interface SavedTeamChoice {
  id: string;
  /** What the list shows: the team's name, plus a note when it is the team being planned for or has no Pokémon. */
  label: string;
  /** A team without Pokémon has nothing to copy. */
  disabled: boolean;
}

/**
 * Every team in the library, in its order. `currentTeamId` is the team the gameplan belongs to: it stays in the list
 * (a mirror match is a real matchup) and is flagged.
 */
export function savedTeamChoices(library: Pick<Library, 'teams'>, currentTeamId: string | null = null): SavedTeamChoice[] {
  return library.teams.map((t) => {
    const empty = parseShowdown(t.paste).length === 0;
    const note = empty ? ' (no Pokémon yet)' : t.id === currentTeamId ? ' (this team — mirror match)' : '';
    return { id: t.id, label: `${t.name}${note}`, disabled: empty };
  });
}

/**
 * The opponent name after picking a saved team: the team's name when the field is empty or still holds the name a
 * previous pick put there; a name the user typed is kept.
 */
export function opponentNameAfterPick(current: string, teamName: string, lastFilled: string | undefined): string {
  const typed = current.trim();
  return !typed || (lastFilled !== undefined && typed === lastFilled.trim()) ? teamName : current;
}
