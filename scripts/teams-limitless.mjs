/**
 * Limitless VGC (limitlessvgc.com): official events (Regionals, Internationals, Worlds, Special Events).
 * Server-rendered HTML, parsed with regexes; the markup is regular. No Stat Points are published there.
 */
import { dayMonthYear, decodeEntities, officialTier, ordinal, textOf } from './teams-common.mjs';

export const LIMITLESS_ORIGIN = 'https://limitlessvgc.com';
export const listingUrl = (page = 1, show = 100, time = '12months') =>
  `${LIMITLESS_ORIGIN}/teams?format=m-c&time=${time}&show=${show}${page > 1 ? `&page=${page}` : ''}`;
export const teamUrl = (id) => `${LIMITLESS_ORIGIN}/teams/${id}`;
export const TOURNAMENTS_URL = `${LIMITLESS_ORIGIN}/tournaments`;

/**
 * The team listing: one row per (team, player, event). The same team id can appear on several rows when players
 * shared a team. Rows are grouped under `<th class="sub-heading">` event headings ("3rd October 2026 - Regional
 * Recife").
 */
export function parseListing(html) {
  const rows = [];
  let event = null;
  const re = /<th class="sub-heading"[^>]*>\s*<a href="\/tournaments\/(\d+)">([^<]*)<\/a>|<tr>\s*<td>([^<]*)<\/td>\s*<td>\s*<a href="\/teams\/(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>\s*<a href="\/players\/(\d+)">([^<]*)<\/a>/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const heading = decodeEntities(m[2]).trim();
      const [when, ...name] = heading.split(' - ');
      event = { tournamentId: Number(m[1]), event: name.join(' - ').trim() || heading, date: dayMonthYear(when) };
      continue;
    }
    rows.push({
      teamId: Number(m[4]),
      tournamentId: event?.tournamentId ?? null,
      event: event?.event ?? '',
      date: event?.date ?? null,
      placing: ordinal(m[3]),
      playerId: Number(m[6]),
      player: decodeEntities(m[7]).trim(),
      species: [...m[5].matchAll(/data-tooltip="([^"]*)"/g)].map((t) => decodeEntities(t[1])),
    });
  }
  return rows;
}

/** A team page: six sets (item, ability, nature, moves; no spreads) and every result the team was used for. */
export function parseTeamPage(html) {
  const sets = [];
  for (const block of html.split('<div class="pkmn"').slice(1)) {
    const id = block.match(/^\s*data-id="([^"]*)"/)?.[1] ?? '';
    const name = textOf(block.match(/<div class="name">([\s\S]*?)<\/div>/)?.[1] ?? '');
    // A Pokémon with no item shows a bare "Held Item:" label.
    const item = textOf(block.match(/<div class="item">([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/^Held Item:\s*/i, '');
    const ability = textOf(block.match(/<div class="ability">([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/^Ability:\s*/i, '');
    const nature = textOf(block.match(/<div class="nature">([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/\s*Nature$/i, '');
    const moves = [...(block.match(/<ul class="moves">([\s\S]*?)<\/ul>/)?.[1] ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((x) => textOf(x[1]))
      .filter(Boolean);
    sets.push({ id, name, item, ability, nature, moves });
  }
  const resultsHtml = html.match(/<div class="teamlist-results">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const results = [...resultsHtml.matchAll(/<li>\s*([^<]*?)\s*<a href="\/tournaments\/(\d+)">([^<]*)<\/a>\s*-\s*<a href="\/players\/(\d+)">([^<]*)<\/a>/g)].map((m) => ({
    placing: ordinal(m[1]),
    tournamentId: Number(m[2]),
    event: decodeEntities(m[3]).trim(),
    playerId: Number(m[4]),
    player: decodeEntities(m[5]).trim(),
  }));
  return { sets, results };
}

/** The tournaments list: id -> { name, players } (the "Players" column), for field sizes. */
export function parseTournaments(html) {
  const out = new Map();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const id = row[1].match(/href="\/tournaments\/(\d+)"/)?.[1];
    if (!id) continue;
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1]));
    const players = cells.map((c) => (/^\d+$/.test(c) ? Number(c) : null)).find((n) => n !== null) ?? null;
    out.set(Number(id), { players });
  }
  return out;
}

/** Limitless only lists official events; anything it can't place is still an official event, so "special". */
export const limitlessTier = (event) => officialTier(event) ?? 'special';
