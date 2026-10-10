// Types for teams-victoryroad.mjs, so the TypeScript tests can import it.
import type { Tier } from '../src/domain/teams.ts';

export const VR_URL: string;
export function vrPlacing(result: string): number | null;
export function vrDate(text: string, today: string): string | null;

export interface VrRow {
  section: string;
  country: string | null;
  player: string;
  handle: string | null;
  event: string;
  eventUrl: string | null;
  result: string;
  placing: number | null;
  tier: Tier;
  date: string | null;
  species: string[];
  replicaCodes: [string, string];
  pasteUrl: string | null;
  replayUrl: string | null;
}
export function parsePage(html: string, today: string): VrRow[];
