/**
 * Team feeds: a small public JSON index of teams (who played it, where, how it placed) whose teams are plain
 * Showdown pastes next to it. Any site can publish one; the app lists a feed's teams and loads the one picked.
 *
 * Feed shape (unknown fields are ignored):
 *   { format, generated, sources?: [{ id, label, url, teams }],
 *     entries: [{ id, title, player, event, date, tier, placing, paste, spreads, replicaCodes?, source, spreadSource?, spreadUrl? }] }
 * `paste` is a path relative to the feed (or an absolute URL on the feed's own site), or null when only the Pokémon
 * are known. A set in a paste with an `EVs:` line has a published (confirmed) spread; a set without one gets the
 * most used Smogon spread from {@link fillSpreads}, and the app labels it estimated.
 *
 * The feed comes from a URL the user typed, so it is read like any other untrusted data (see codec.ts): every field
 * is type-checked, text is capped, counts are bounded and only http(s) links are kept. No DOM here.
 */
import { DataError } from './codec.ts';
import { spreadLine, toID, type Dex } from './dex.ts';
import type { PokemonSet } from './types.ts';

export type FeedTier = 'worlds' | 'international' | 'regional' | 'special' | 'online' | 'ranked' | 'creator';
/** Best first. */
export const FEED_TIERS: readonly FeedTier[] = ['worlds', 'international', 'regional', 'special', 'online', 'ranked', 'creator'] as const;
/** Tiers counted as official Play! Pokémon events. */
export const OFFICIAL_TIERS: readonly FeedTier[] = ['worlds', 'international', 'regional', 'special'] as const;

export const TIER_LABEL: Readonly<Record<FeedTier, string>> = {
  worlds: 'World Championships',
  international: 'International Championships',
  regional: 'Regional Championships',
  special: 'Special Event',
  online: 'Online tournament',
  ranked: 'Ranked Battles',
  creator: 'Content creator',
};

/** Whether the paste's spreads were published by the player (all, some) or are left for the app to estimate. */
export type FeedSpreads = 'confirmed' | 'partial' | 'estimated';
const SPREADS: readonly FeedSpreads[] = ['confirmed', 'partial', 'estimated'];

export interface FeedEntry {
  id: string;
  title: string;
  player: string;
  event: string;
  /** YYYY-MM-DD, or '' when the feed gave none. */
  date: string;
  tier: FeedTier;
  /** 1 for a win; null when not ranked (a content creator's team). */
  placing: number | null;
  /** As written in the feed (relative to it, usually); null when only the Pokémon are known. Resolve with {@link resolvePaste}. */
  paste: string | null;
  spreads: FeedSpreads;
  /** In-game rental (replica) codes. */
  replicaCodes?: string[];
  /** Where the team was published (an http(s) URL), or ''. */
  source: string;
  /** Where the spreads came from, e.g. "youtube". */
  spreadSource?: string;
  spreadUrl?: string;
}

export interface FeedSource { id: string; label: string; url: string; teams: number }

export interface TeamFeed {
  format: string;
  /** ISO timestamp, or ''. */
  generated: string;
  sources: FeedSource[];
  entries: FeedEntry[];
  /** Entries left out because they were malformed or repeated. */
  skipped: number;
}

export const FEED_LIMITS = { entries: 2000, sources: 20, replicaCodes: 4, text: 200, id: 120, url: 500, paste: 20_000 } as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Text trimmed and cut to `max` characters (by code point, so an emoji is never split). */
const text = (v: unknown, max: number = FEED_LIMITS.text): string =>
  typeof v === 'string' ? Array.from(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '';
/** An absolute http(s) URL, or ''. Anything else (javascript:, data:, relative) is dropped so it never becomes a link. */
function httpUrl(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > FEED_LIMITS.url) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

function readEntry(raw: unknown): FeedEntry | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id.length <= FEED_LIMITS.id ? raw.id.trim() : '';
  const tier = FEED_TIERS.find((t) => t === raw.tier);
  if (!id || !tier) return null;
  let paste: string | null = null;
  if (typeof raw.paste === 'string' && raw.paste.trim()) {
    if (raw.paste.length > FEED_LIMITS.url) return null;
    paste = raw.paste.trim();
  } else if (raw.paste !== null && raw.paste !== undefined) return null;
  const player = text(raw.player);
  const event = text(raw.event);
  const entry: FeedEntry = {
    id,
    title: text(raw.title) || [player, event].filter(Boolean).join(' — ') || id,
    player,
    event,
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : '',
    tier,
    placing: typeof raw.placing === 'number' && Number.isInteger(raw.placing) && raw.placing >= 1 && raw.placing <= 100_000 ? raw.placing : null,
    paste,
    spreads: SPREADS.find((s) => s === raw.spreads) ?? 'estimated',
    source: httpUrl(raw.source),
  };
  if (Array.isArray(raw.replicaCodes)) {
    const codes = raw.replicaCodes.slice(0, FEED_LIMITS.replicaCodes).filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9]{1,16}$/.test(c));
    if (codes.length) entry.replicaCodes = codes.map((c) => c.toUpperCase());
  }
  const spreadSource = text(raw.spreadSource, 40);
  if (spreadSource) entry.spreadSource = spreadSource;
  const spreadUrl = httpUrl(raw.spreadUrl);
  if (spreadUrl) entry.spreadUrl = spreadUrl;
  return entry;
}

function readSource(raw: unknown): FeedSource | null {
  if (!isObj(raw)) return null;
  const label = text(raw.label, 60) || text(raw.id, 60);
  const teams = typeof raw.teams === 'number' && Number.isInteger(raw.teams) && raw.teams >= 0 ? raw.teams : null;
  if (!label || teams === null) return null;
  return { id: text(raw.id, 60) || label, label, url: httpUrl(raw.url), teams };
}

/**
 * Validates a feed. Malformed entries are skipped (and counted) rather than failing the whole feed; a feed that
 * isn't one at all, is too large, or has no readable entry throws {@link DataError} with a message for people.
 */
export function readFeed(json: unknown): TeamFeed {
  if (!isObj(json) || !('entries' in json)) throw new DataError("That address didn't return a team feed (no list of teams in it).");
  if (!Array.isArray(json.entries)) throw new DataError("The feed's list of teams isn't a list.");
  if (json.entries.length > FEED_LIMITS.entries) throw new DataError(`The feed lists ${json.entries.length} teams; the app reads at most ${FEED_LIMITS.entries}.`);
  const entries: FeedEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of json.entries) {
    const entry = readEntry(raw);
    if (!entry || seen.has(entry.id)) { skipped++; continue; }
    seen.add(entry.id);
    entries.push(entry);
  }
  if (!entries.length && json.entries.length) throw new DataError(`None of the feed's ${json.entries.length} teams could be read.`);
  const sources = Array.isArray(json.sources)
    ? json.sources.slice(0, FEED_LIMITS.sources).map(readSource).filter((s): s is FeedSource => s !== null)
    : [];
  return {
    format: text(json.format),
    generated: typeof json.generated === 'string' && !Number.isNaN(Date.parse(json.generated)) && json.generated.length <= 40 ? json.generated : '',
    sources,
    entries,
    skipped,
  };
}

/**
 * The absolute URL of an entry's paste, resolved against the feed's own URL; null when the entry has no paste.
 * A paste must live on the feed's site: a link to anywhere else is refused with a {@link DataError}.
 */
export function resolvePaste(feedUrl: string, entry: Pick<FeedEntry, 'paste'>): string | null {
  if (!entry.paste) return null;
  let feed: URL;
  let paste: URL;
  try {
    feed = new URL(feedUrl);
    paste = new URL(entry.paste, feed);
  } catch {
    throw new DataError("That team's paste address isn't valid.");
  }
  if ((paste.protocol !== 'https:' && paste.protocol !== 'http:') || paste.origin !== feed.origin) {
    throw new DataError("That team's paste is on a different site than the feed, so it wasn't loaded.");
  }
  return paste.href;
}

/** The most used Smogon spread for a set, as [nature, Stat Points line]: its Mega's when it holds the stone, preferring the player's nature. */
export function usageSpread(set: PokemonSet, dex: Dex): { nature: string; evs: string } | null {
  const mons = dex.usageFor(dex.species(set.species));
  const mon = mons.find((m) => !!set.item && !!m.mega && toID(m.mega) === toID(set.item)) ?? mons.find((m) => !m.mega) ?? mons[0];
  const spread = mon && (mon.spreads.find(([nature]) => !!set.nature && toID(nature) === toID(set.nature)) ?? mon.spreads[0]);
  if (!spread) return null;
  const evs = spreadLine(spread[1]);
  return evs ? { nature: spread[0], evs } : null;
}

/**
 * Fills in a spread for every set that has none (no `EVs:` line) from Smogon usage (see {@link usageSpread}); the
 * player's nature is kept when they gave one. Sets with a spread are returned as they were. `estimated` lists the
 * species that were filled, so the UI can label them. Species without usage data stay empty and aren't listed.
 */
export function fillSpreads(sets: readonly PokemonSet[], dex: Dex): { sets: PokemonSet[]; estimated: string[] } {
  const estimated: string[] = [];
  const out = sets.map((s) => {
    const set = structuredClone(s);
    if (set.evs.trim()) return set;
    const spread = usageSpread(set, dex);
    if (spread) {
      set.nature ||= spread.nature;
      set.evs = spread.evs;
      estimated.push(set.species);
    }
    return set;
  });
  return { sets: out, estimated };
}

/**
 * Which of the filled-in spreads are still there after the paste was edited: `filled` maps each estimated species
 * to the Stat Points line it was given; a species whose set is gone or whose spread changed is no longer estimated.
 */
export function stillEstimated(sets: readonly PokemonSet[], filled: Readonly<Record<string, string>>): string[] {
  return sets.filter((s) => Object.hasOwn(filled, s.species) && filled[s.species] === s.evs.trim()).map((s) => s.species);
}

/** A placing as an ordinal: 1 → "1st", 23 → "23rd", 112 → "112th"; null → "". */
export function placingLabel(placing: number | null): string {
  if (placing === null) return '';
  const tens = placing % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[placing % 10] ?? 'th';
  return `${placing}${suffix}`;
}
