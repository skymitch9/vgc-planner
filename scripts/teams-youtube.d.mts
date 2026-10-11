// Types for teams-youtube.mjs, so the TypeScript tests can import it.
import type { PasteLink } from '../src/domain/paste-links.ts';

export const CHANNELS: string[];
export const SINCE: string;
export const MAX_VIDEOS: number;
export const API: string;
export function readYoutubeKey(root: string, env?: Record<string, string | undefined>): string;
export function hideKey(text: unknown, key: string): string;
export function channelUrl(handle: string, key: string): string;
export function playlistUrl(playlistId: string, pageToken: string, key: string): string;
export function playlistKey(playlistId: string, pageToken?: string | null): string;
export function splitPlaylistKey(key: string): { playlistId: string; pageToken: string };
export function videoUrl(id: string): string;

export interface YoutubeVideo { id: string; title: string; date: string; url: string; description: string; channel: string }
export function readChannel(json: string): { id: string; title: string; uploads: string } | null;
export function readPlaylistPage(json: string, since: string): { videos: YoutubeVideo[]; next: string | null; reachedSince: boolean };
export function descriptionLinks(text: string): PasteLink[];

interface KeyedSet { species: string; item: string; nature?: string; evs?: string }
export function teamKey(sets: readonly KeyedSet[]): string;
export function sameTeam(a: readonly KeyedSet[], b: readonly KeyedSet[]): boolean;
export function attachSpreads(target: { sets: KeyedSet[] }, from: readonly KeyedSet[]): number;
export function harvestVideos(options: {
  load: (kind: string, key: string) => Promise<string | null>;
  channels?: string[];
  since?: string;
  maxVideos?: number;
  log?: (line: string) => void;
}): Promise<{ videos: YoutubeVideo[]; calls: number }>;
