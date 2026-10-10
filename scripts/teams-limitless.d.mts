// Types for teams-limitless.mjs, so the TypeScript tests can import it.
import type { Tier } from '../src/domain/teams.ts';

export const LIMITLESS_ORIGIN: string;
export const TOURNAMENTS_URL: string;
export function listingUrl(page?: number, show?: number, time?: string): string;
export function teamUrl(id: number | string): string;

export interface ListingRow {
  teamId: number;
  tournamentId: number | null;
  event: string;
  date: string | null;
  placing: number | null;
  playerId: number;
  player: string;
  species: string[];
}
export function parseListing(html: string): ListingRow[];

export interface LimitlessSet { id: string; name: string; item: string; ability: string; nature: string; moves: string[] }
export interface LimitlessResult { placing: number | null; tournamentId: number; event: string; playerId: number; player: string }
export function parseTeamPage(html: string): { sets: LimitlessSet[]; results: LimitlessResult[] };
export function parseTournaments(html: string): Map<number, { players: number | null }>;
export function limitlessTier(event: string): Tier;
