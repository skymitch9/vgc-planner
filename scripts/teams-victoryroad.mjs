/**
 * Victory Road "Champions Replica Teams" (victoryroad.pro/champions-replica/): rental (replica) codes, and for a few
 * rows a paste link with the player's real sets.
 *
 * Only the Reg M-C tables are read. The page continues with LEGACY tables (older regulations and Scarlet & Violet,
 * with 252-EV pastes from the old game); those come after the "Past formats" heading, and one sits inside the
 * Ranked section with screenshots instead of codes. A row is kept only when it is above "Past formats" AND its code
 * cell holds the two 5-character codes the M-C tables use.
 */
import { dayMonthYear, decodeEntities, isoDate, monthIndex, officialTier, ordinal, textOf } from './teams-common.mjs';

export const VR_URL = 'https://victoryroad.pro/champions-replica/';

const CODE_CELL = /^\s*([A-Z0-9]{5})\s*<br\s*\/?>\s*([A-Z0-9]{5})\s*$/;

/** "Champion" 1, "Finalist" 2, "Top 8" 8 (the cut it reached), "13th" 13, anything else null. */
export function vrPlacing(result) {
  const r = String(result ?? '').trim();
  if (/^(champion|winner)$/i.test(r)) return 1;
  if (/^(finalist|runner[- ]?up)$/i.test(r)) return 2;
  const top = r.match(/^top\s*(\d+)$/i);
  if (top) return Number(top[1]);
  return ordinal(r);
}

/**
 * "September 26th" has no year: it is the latest such date on or before `today` ("YYYY-MM-DD"). Dates with a
 * year ("29 Jan 2023") are read as they are.
 */
export function vrDate(text, today) {
  const full = dayMonthYear(text);
  if (full) return full;
  const m = String(text ?? '').match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (!m || monthIndex(m[1]) < 0) return null;
  const year = Number(today.slice(0, 4));
  const date = isoDate(year, monthIndex(m[1]), Number(m[2]));
  return date > today ? isoDate(year - 1, monthIndex(m[1]), Number(m[2])) : date;
}

/** Parses the Reg M-C rows. `today` ("YYYY-MM-DD") resolves dates written without a year. */
export function parsePage(html, today) {
  const end = html.search(/<h[23][^>]*>\s*(?:<[^>]+>\s*)*Past formats/i);
  const body = end >= 0 ? html.slice(0, end) : html;
  const headings = [...body.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => ({ at: m.index, text: textOf(m[1]) }));
  const rows = [];
  for (const table of body.matchAll(/<table class="infobox2[^"]*"[\s\S]*?<\/table>/g)) {
    const section = headings.filter((h) => h.at < table.index).at(-1)?.text ?? '';
    for (const tr of table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (cells.length < 7) continue;
      const codes = cells[4].match(CODE_CELL);
      if (!codes) continue;
      const [flag, who, res, team, , paste, replay] = cells;

      const bold = res.match(/<b>([\s\S]*?)<\/b>/)?.[1] ?? '';
      const [eventHtml, ...resultHtml] = bold.split(/<br\s*\/?>/i);
      const event = textOf(eventHtml);
      const result = textOf(resultHtml.join(' '));
      const ranked = /ranked/i.test(section);
      const tier = officialTier(event) ?? (ranked && !/global challenge/i.test(event) ? 'ranked' : 'online');

      rows.push({
        section,
        country: flag.match(/title="([A-Z]{3})"/)?.[1] ?? null,
        player: textOf(who.match(/<b>([\s\S]*?)<\/b>/)?.[1] ?? who),
        handle: textOf(who.match(/\(([\s\S]*?)\)\s*$/)?.[1] ?? '') || null,
        event,
        eventUrl: decodeEntities(eventHtml.match(/href="([^"]+)"/)?.[1] ?? '') || null,
        result,
        placing: vrPlacing(result),
        tier,
        date: vrDate(textOf(res.match(/\(([^()]*)\)\s*$/)?.[1] ?? ''), today),
        species: [...team.matchAll(/<img[^>]*\btitle="([^"]+)"/g)].map((m) => decodeEntities(m[1])),
        replicaCodes: [codes[1], codes[2]],
        pasteUrl: decodeEntities(paste.match(/href="([^"]+)"/)?.[1] ?? '') || null,
        replayUrl: decodeEntities(replay.match(/href="([^"]+)"/)?.[1] ?? '') || null,
      });
    }
  }
  return rows;
}
