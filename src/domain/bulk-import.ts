/**
 * Bulk import: cutting one block of text into teams. The text may mix paste links (pokepast.es, vrpastes.com),
 * Pokémon Showdown teambuilder backups (`=== [format] Folder/Name ===` headers), teams separated by a line of dashes
 * or equals signs, and plain runs of Pokémon (cut into teams of six). No DOM and no network here: links are returned
 * as links, for the caller to download.
 */
import { EXPORT_FORMAT, LIMITS } from './codec.ts';
import { writeTeam } from './dex.ts';
import { parsePasteLink, type PasteSite } from './paste-links.ts';
import { REGULATION } from './regulation.ts';
import { parseShowdown } from './showdown.ts';
import type { PokemonSet } from './types.ts';

export interface BulkLink { kind: 'link'; url: string; site: PasteSite }
export interface BulkPaste {
  kind: 'paste';
  /** The team's name, when a teambuilder header gave one. */
  name?: string;
  paste: string;
  /** The leftover of a run of Pokémon that was cut into teams of six (1 to 5 Pokémon). */
  partial?: true;
}
/** A line that is a web address but not a team link this app can read; reported, never imported. */
export interface BulkBadLink { kind: 'badlink'; url: string }
export type BulkItem = BulkLink | BulkPaste | BulkBadLink;

/** The most teams one bulk import takes. */
export const BULK_MAX_ITEMS = 50;

/** A line of three or more dashes or equals signs, alone. */
const SEPARATOR = /^(?:-{3,}|={3,})$/;
/** `=== [gen9vgc2026] Folder/Team name ===` (the format tag and the folder are optional). */
const HEADER = /^===\s*(?:\[[^\]]*\]\s*)?(.*?)\s*===$/;

/** A web address alone on its line (so not a Pokémon's head line, which never looks like one). */
const ADDRESS = /^(?:https?:\/\/|www\.)\S+$|^(?:pokepast\.es|vrpastes\.com)(?:\/\S*)?$/i;

/** The team name in a teambuilder header (no format tag, no folder), or null when the line isn't one. */
function headerName(line: string): string | null {
  const m = line.match(HEADER);
  if (!m) return null;
  const full = m[1] ?? '';
  return full.slice(full.lastIndexOf('/') + 1).trim();
}

/** One run of text with no links, headers or separators in it: one team, or several when it holds more than six Pokémon. */
function chunkItems(lines: readonly string[], name: string | undefined): BulkPaste[] {
  const mons = lines.join('\n').split(/\n\s*\n/).map((b) => b.trim()).filter((b) => parseShowdown(b).length > 0);
  const size = REGULATION.teamSize;
  const out: BulkPaste[] = [];
  for (let i = 0; i < mons.length; i += size) {
    const group = mons.slice(i, i + size);
    const item: BulkPaste = { kind: 'paste', paste: `${group.join('\n\n')}\n` };
    if (name) item.name = name;
    if (mons.length > size && group.length < size) item.partial = true;
    out.push(item);
  }
  return out;
}

/**
 * Cuts `text` into teams, in the order they appear. In order of precedence: a line that is a paste link is a team of
 * its own (any other web address alone on a line is kept as a bad link, for the caller to report); a teambuilder
 * header starts a team and names it; a line of dashes or equals signs ends a team; what is left is cut every six
 * Pokémon. Blank lines between the Pokémon of a team are ordinary and never cut it.
 * Not capped: see {@link capBulk}.
 */
export function splitBulk(text: string | null | undefined): BulkItem[] {
  const items: BulkItem[] = [];
  let lines: string[] = [];
  let name: string | undefined;
  const flush = (): void => {
    items.push(...chunkItems(lines, name));
    lines = [];
    name = undefined;
  };
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const link = parsePasteLink(line);
    if (link) {
      flush();
      items.push({ kind: 'link', url: line, site: link.site });
      continue;
    }
    if (ADDRESS.test(line)) {
      flush();
      items.push({ kind: 'badlink', url: line });
      continue;
    }
    if (SEPARATOR.test(line)) { flush(); continue; }
    const header = headerName(line);
    if (header !== null) {
      flush();
      name = header || undefined;
      continue;
    }
    lines.push(raw.trimEnd());
  }
  flush();
  return items;
}

export interface BulkCap {
  items: BulkItem[];
  /** How many items were left out. */
  dropped: number;
  /** Why: more than {@link BULK_MAX_ITEMS} at once, or the library is (nearly) full. */
  reason: 'batch' | 'library' | null;
}

/** Keeps what fits: at most {@link BULK_MAX_ITEMS} items, and no more than the library has room for. */
export function capBulk(items: readonly BulkItem[], existingTeams: number): BulkCap {
  const room = Math.max(0, LIMITS.teams - existingTeams);
  const limit = Math.min(BULK_MAX_ITEMS, room);
  if (items.length <= limit) return { items: [...items], dropped: 0, reason: null };
  return { items: items.slice(0, limit), dropped: items.length - limit, reason: room < BULK_MAX_ITEMS ? 'library' : 'batch' };
}

/**
 * A name for an imported team: `hint` (a header's or a paste's title) when there is one, else its first two Pokémon.
 * A name already in `taken` gets " (2)", " (3)"... so that no two teams share one (compared without case).
 */
export function nameFor(sets: readonly PokemonSet[], hint?: string, taken: readonly string[] = []): string {
  const room = LIMITS.nameLength - 8;
  const base = ((hint ?? '').trim() || sets.slice(0, 2).map((s) => s.species).join(' / ') || 'Team').slice(0, room).trim();
  return firstFree(taken, (n) => (n === 1 ? base : `${base} (${n})`));
}

/**
 * A name for a duplicate of the team called `name`: "name (copy)", then "name (copy 2)", "name (copy 3)"... so that
 * it is not in `taken` (compared without case).
 */
export function copyNameFor(name: string, taken: readonly string[] = []): string {
  const base = name.trim().slice(0, LIMITS.nameLength - 12).trim() || 'Team';
  return firstFree(taken, (n) => (n === 1 ? `${base} (copy)` : `${base} (copy ${n})`));
}

/** `candidate(1)`, `candidate(2)`... : the first one not in `taken` (compared without case). */
function firstFree(taken: readonly string[], candidate: (n: number) => string): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  let n = 1;
  while (used.has(candidate(n).toLowerCase())) n++;
  return candidate(n);
}

/** Two pastes with the same key hold the same sets, whatever their spacing or line endings. */
export const teamKey = (sets: readonly PokemonSet[]): string => writeTeam(sets);

/** True when `text` is this app's own export file (JSON carrying its format tag) rather than team pastes. */
export function looksLikeBackup(text: string | null | undefined): boolean {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith('{')) return false;
  try {
    const data = JSON.parse(raw) as unknown;
    return typeof data === 'object' && data !== null && (data as Record<string, unknown>).format === EXPORT_FORMAT;
  } catch { return false; }
}
