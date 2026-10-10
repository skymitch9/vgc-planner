/**
 * crob.at: community online tournaments (mostly play.limitlesstcg.com events) with provenance. The listing is HTML;
 * each team comes from the documented public API `GET /api/team/:slug` (no key; rate limited with 429 +
 * Retry-After). Its Showdown paste has no EVs.
 */
import { FORMAT_ID, decodeEntities } from './teams-common.mjs';

export const CROB_ORIGIN = 'https://crob.at';
export const listingUrl = (page = 1) => `${CROB_ORIGIN}/teams/vgc?page=${page}`;
export const teamApiUrl = (slug) => `${CROB_ORIGIN}/api/team/${encodeURIComponent(slug)}`;

/** One listing page: the team cards (slug + format) and the page count ("Page 1 of 21"). */
export function parseListing(html) {
  const cards = [];
  for (const m of html.matchAll(/<a\s+class="[^"]*\bbrowse-team-card\b[^"]*"\s+href="\/([A-Za-z0-9_-]{4,16})"([^>]*)>/g)) {
    cards.push({ slug: m[1], format: m[2].match(/data-team-browser-format="([^"]*)"/)?.[1] ?? '' });
  }
  const pages = Number(html.match(/Page\s+\d+\s+of\s+(\d+)/)?.[1] ?? 1);
  return { cards, pages };
}

/**
 * The API's team JSON, reduced to what the app keeps. Null when it holds no Reg M-C team. Only tournament
 * provenance is kept as an event; anything else is still a team but without a placing.
 */
export function parseTeam(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const team = (d?.teams ?? []).find((t) => t?.format === FORMAT_ID && typeof t.paste === 'string' && t.paste.trim());
  if (!team) return null;
  const p = d.provenance ?? {};
  const t = d.tournament ?? {};
  const date = String(p.eventDate ?? t.startsAt ?? d.created_at ?? '').slice(0, 10);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    slug: String(d.slug),
    name: decodeEntities(d.name ?? '').trim(),
    author: decodeEntities(d.author ?? '').trim(),
    event: decodeEntities(p.eventName ?? t.name ?? '').trim(),
    date: /^\d{4}-\d\d-\d\d$/.test(date) ? date : null,
    placing: num(p.placement ?? t.placement),
    fieldSize: num(p.fieldSize ?? t.playerCount),
    sourceUrl: String(p.sourceUrl ?? d.source_url ?? ''),
    paste: team.paste,
  };
}

/** The player's name: crob titles teams "<player>'s 1st Place - <event>"; the author is the uploader. */
export function crobPlayer(team) {
  const m = team.name.match(/^(.+?)['’]s\s+\d+(?:st|nd|rd|th)\s+Place\b/i);
  return (m?.[1] ?? team.author).trim();
}
