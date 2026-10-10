// Types for teams-crob.mjs, so the TypeScript tests can import it.
export const CROB_ORIGIN: string;
export function listingUrl(page?: number): string;
export function teamApiUrl(slug: string): string;
export function parseListing(html: string): { cards: { slug: string; format: string }[]; pages: number };

export interface CrobTeam {
  slug: string;
  name: string;
  author: string;
  event: string;
  date: string | null;
  placing: number | null;
  fieldSize: number | null;
  sourceUrl: string;
  paste: string;
}
export function parseTeam(json: string | object): CrobTeam | null;
export function crobPlayer(team: CrobTeam): string;
