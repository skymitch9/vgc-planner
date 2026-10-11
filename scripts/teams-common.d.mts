// Types for teams-common.mjs, so the TypeScript tests can import it.
import type { DexData, UsageData } from '../src/domain/dex.ts';
import type { Tier } from '../src/domain/teams.ts';

export const USER_AGENT: string;
export const FORMAT_ID: string;
export function toID(s: unknown): string;
export function decodeEntities(text: string | null | undefined): string;
export function textOf(html: string | null | undefined): string;
export function ordinal(text: string | null | undefined): number | null;
export function monthIndex(word: string): number;
export function isoDate(y: number, mIndex: number, d: number): string;
export function dayMonthYear(text: string | null | undefined): string | null;
export const TIERS: Tier[];
export function officialTier(event: string | null | undefined): Tier | null;
export function compareTeams(a: { tier: string; placing: number | null; date: string; id: string }, b: { tier: string; placing: number | null; date: string; id: string }): number;

export interface RawSet { species: string; item?: string; ability?: string; nature?: string; moves?: string[]; evs?: string }
export interface NormalSet { species: string; item: string; ability: string; nature: string; moves: string[]; evs?: string }
export interface Resolver {
  species(raw: string): { species: string; item?: string } | null;
  baseAbilityForMega(species: string, item: string, ability: string): string | null;
  stoneOwner(raw: string | null | undefined): string | null;
  item(raw: string): string | null;
  ability(raw: string): string | null;
  move(raw: string): string | null;
  nature(raw: string): string | null;
}
export function makeResolver(dex: DexData, usage?: UsageData | null): Resolver;
export function normaliseSet(raw: RawSet, resolve: Resolver): { set: NormalSet; note?: string; error?: undefined } | { error: string; set?: undefined; note?: undefined };
export function politeFetch(url: string, options?: { gap?: number; retries?: number; timeout?: number }): Promise<string>;
