/**
 * Builds the top-teams data from the three sources. Every network or file read goes through `load(kind, key)`, so
 * scripts/fetch-teams.mjs can run it live and the tests can run it over saved fixtures.
 *
 *   kind                    key          returns
 *   limitless-listing       page number  listing HTML
 *   limitless-tournaments   'all'        tournaments list HTML
 *   limitless-team          team id      team page HTML
 *   crob-listing            page number  listing HTML
 *   crob-team               slug         API JSON text
 *   victoryroad             'page'       replica page HTML
 *   pokepaste / vrpastes    paste id     the paste site's JSON text
 *
 * `load` returns null for something that isn't there (offline mode); a live failure throws and is logged as a skip.
 */
import { Dex, setProblems, teamProblems } from '../src/domain/dex.ts';
import { parsePasteLink, readPokepaste, readVrPaste } from '../src/domain/paste-links.ts';
import { parseShowdown } from '../src/domain/showdown.ts';
import { statPoints } from '../src/domain/stats.ts';
import { spreadLine } from '../src/domain/dex.ts';
import { teamSets } from '../src/domain/teams.ts';
import { FORMAT_ID, compareTeams, makeResolver, normaliseSet, toID } from './teams-common.mjs';
import * as limitless from './teams-limitless.mjs';
import * as crob from './teams-crob.mjs';
import * as vr from './teams-victoryroad.mjs';

export const FORMAT_NAME = '[Gen 9 Champions] VGC 2026 Reg M-C';
export const SOURCE_INFO = {
  limitless: { label: 'Limitless VGC', url: 'https://limitlessvgc.com/teams?format=m-c' },
  crob: { label: 'crob.at', url: 'https://crob.at/teams/vgc' },
  victoryroad: { label: 'Victory Road', url: vr.VR_URL },
};
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/** Showdown text sets -> raw sets; real EVs (above Stat Point range) become Stat Points the app's way. */
function pasteSets(paste) {
  return parseShowdown(paste).map((s) => {
    const reading = statPoints(s);
    const evs = reading ? spreadLine(reading.sp) : '';
    return { species: s.species, item: s.item, ability: s.ability, nature: s.nature, moves: s.moves, ...(evs ? { evs } : {}) };
  });
}

/** The species set of a team as a comparable key ("archaludon|charizard|..."). */
const speciesKey = (sets) => sets.map((s) => toID(s.species)).sort().join('|');
const surname = (name) => toID(String(name ?? '').trim().split(/\s+/).at(-1));

/**
 * @param {object} o
 * @param {(kind: string, key: string|number) => Promise<string|null>} o.load
 * @param {object} o.dexData  src/data/champions-mc.json
 * @param {object} [o.usageData]  src/data/usage-mc.json (for validating with filled-in spreads)
 * @param {string[]} [o.sources]
 * @param {number} [o.limit]  at most this many teams fetched per source
 * @param {string} o.today  YYYY-MM-DD
 * @param {(line: string) => void} [o.log]
 */
export async function buildTeams({ load, dexData, usageData = null, sources = ['limitless', 'crob', 'victoryroad'], limit = Infinity, today, log = () => {} }) {
  const resolve = makeResolver(dexData);
  const dex = new Dex(dexData, usageData);
  const skipped = [];
  const skip = (id, reason) => {
    skipped.push({ id, reason });
    log(`  skip ${id}: ${reason}`);
  };
  const info = {};
  const teams = [];

  /** Normalises raw sets into the dex's names; null (and a skip) when the team can't be used. */
  function normaliseTeam(id, rawSets, { needSets = true } = {}) {
    const sets = [];
    for (const raw of rawSets) {
      const r = normaliseSet(raw, resolve);
      if (r.error) { skip(id, r.error); return null; }
      sets.push(r.set);
    }
    if (sets.length !== 6) { skip(id, `${sets.length} Pokémon, not 6`); return null; }
    if (new Set(sets.map((s) => toID(s.species))).size !== 6) { skip(id, 'the same species twice'); return null; }
    if (needSets && sets.some((s) => !s.moves.length)) { skip(id, 'a Pokémon without moves'); return null; }
    return sets;
  }

  const safeLoad = async (id, kind, key) => {
    try {
      return await load(kind, key);
    } catch (err) {
      skip(id, `fetch failed: ${err.message}`);
      return null;
    }
  };

  // ---- Limitless ----------------------------------------------------------------------------------------------
  if (sources.includes('limitless')) {
    const rows = [];
    const seenRows = new Set();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await safeLoad(`limitless listing page ${page}`, 'limitless-listing', page);
      if (!html) break;
      const got = limitless.parseListing(html);
      const fresh = got.filter((r) => !seenRows.has(`${r.teamId}/${r.tournamentId}/${r.playerId}`));
      for (const r of fresh) seenRows.add(`${r.teamId}/${r.tournamentId}/${r.playerId}`);
      rows.push(...fresh);
      if (got.length < PAGE_SIZE || !fresh.length) break;
    }
    const fieldSizes = limitless.parseTournaments((await safeLoad('limitless tournaments', 'limitless-tournaments', 'all')) ?? '');
    // One entry per team id: the best result it was used for (a team shared by several players is listed once).
    const best = new Map();
    for (const r of rows) {
      const tier = limitless.limitlessTier(r.event);
      const cur = best.get(r.teamId);
      const cand = { ...r, tier, id: `limitless-${r.teamId}`, date: r.date ?? '' };
      if (!cur || compareTeams(cand, cur) < 0) best.set(r.teamId, cand);
    }
    log(`limitless: ${rows.length} listing rows, ${best.size} distinct teams`);
    let n = 0;
    for (const r of best.values()) {
      if (n >= limit) break;
      const id = `limitless-${r.teamId}`;
      const html = await safeLoad(id, 'limitless-team', r.teamId);
      if (!html) continue;
      n++;
      const page = limitless.parseTeamPage(html);
      const sets = normaliseTeam(
        id,
        page.sets.map((s) => ({ species: s.id || s.name, item: s.item, ability: s.ability, nature: s.nature, moves: s.moves })),
      );
      if (!sets) continue;
      if (!r.date) {
        skip(id, 'no event date');
        continue;
      }
      teams.push({
        id,
        source: 'limitless',
        event: r.event,
        eventUrl: r.tournamentId ? `${limitless.LIMITLESS_ORIGIN}/tournaments/${r.tournamentId}` : undefined,
        date: r.date,
        tier: r.tier,
        placing: r.placing,
        fieldSize: fieldSizes.get(r.tournamentId)?.players ?? undefined,
        player: r.player,
        sourceUrl: limitless.teamUrl(r.teamId),
        setsKnown: true,
        sets,
      });
    }
    info.limitless = { fetched: new Date().toISOString() };
  }

  // ---- crob.at --------------------------------------------------------------------------------------------------
  if (sources.includes('crob')) {
    const slugs = [];
    let pages = 1;
    for (let page = 1; page <= pages && page <= MAX_PAGES; page++) {
      const html = await safeLoad(`crob listing page ${page}`, 'crob-listing', page);
      if (!html) break;
      const got = crob.parseListing(html);
      pages = got.pages;
      for (const c of got.cards) if (c.format === FORMAT_ID && !slugs.includes(c.slug)) slugs.push(c.slug);
    }
    log(`crob: ${slugs.length} Reg M-C teams listed`);
    let n = 0;
    for (const slug of slugs) {
      if (n >= limit) break;
      const id = `crob-${slug}`;
      const text = await safeLoad(id, 'crob-team', slug);
      if (!text) continue;
      n++;
      let t;
      try {
        t = crob.parseTeam(text);
      } catch (err) {
        skip(id, `unreadable JSON: ${err.message}`);
        continue;
      }
      if (!t) {
        skip(id, 'no Reg M-C team in it');
        continue;
      }
      if (!t.date) {
        skip(id, 'no event date');
        continue;
      }
      const sets = normaliseTeam(id, pasteSets(t.paste));
      if (!sets) continue;
      const eventUrl = /^https:\/\/play\.limitlesstcg\.com\/tournament\/[^/]+\//.test(t.sourceUrl)
        ? t.sourceUrl.replace(/^(https:\/\/play\.limitlesstcg\.com\/tournament\/[^/]+)\/.*$/, '$1/standings')
        : undefined;
      teams.push({
        id,
        source: 'crob',
        event: t.event || t.name,
        eventUrl,
        date: t.date,
        tier: 'online',
        placing: t.placing,
        fieldSize: t.fieldSize ?? undefined,
        player: crob.crobPlayer(t),
        sourceUrl: `${crob.CROB_ORIGIN}/${slug}`,
        setsKnown: true,
        sets,
      });
    }
    info.crob = { fetched: new Date().toISOString() };
  }

  // ---- Victory Road -------------------------------------------------------------------------------------------
  if (sources.includes('victoryroad')) {
    const html = await safeLoad('victoryroad page', 'victoryroad', 'page');
    const rows = html ? vr.parsePage(html, today) : [];
    log(`victoryroad: ${rows.length} Reg M-C rows with codes`);
    let merged = 0;
    let n = 0;
    for (const row of rows) {
      if (n >= limit) break;
      n++;
      const id = `victoryroad-${row.replicaCodes.join('')}`;
      const species = normaliseTeam(id, row.species.map((s) => ({ species: s })), { needSets: false });
      if (!species) continue;
      const key = speciesKey(species);

      // A paste link carries the player's real sets; used only when it is the same six Pokémon.
      let sets = null;
      const link = row.pasteUrl ? parsePasteLink(row.pasteUrl) : null;
      if (row.pasteUrl && !link) log(`  note ${id}: paste link not recognised (${row.pasteUrl})`);
      if (link) {
        const text = await safeLoad(id, link.site === 'pokepaste' ? 'pokepaste' : 'vrpastes', link.id);
        if (text) {
          try {
            const read = link.site === 'pokepaste' ? readPokepaste(JSON.parse(text)) : readVrPaste(JSON.parse(text));
            const fromPaste = normaliseTeam(`${id} paste`, pasteSets(read.paste));
            if (fromPaste && speciesKey(fromPaste) === key) sets = fromPaste;
            else if (fromPaste) log(`  note ${id}: its paste ${row.pasteUrl} is a different team; ignored`);
          } catch (err) {
            log(`  note ${id}: paste unreadable (${err.message})`);
          }
        }
      }

      // Attach the codes to the same team from an official (or online) source instead of listing it twice.
      const target = teams.find(
        (t) =>
          t.source !== 'victoryroad' &&
          !t.replicaCodes &&
          speciesKey(t.sets) === key &&
          (surname(t.player) === surname(row.player) || (row.handle && toID(t.player) === toID(row.handle)) || toID(t.player) === toID(row.player)),
      );
      if (target) {
        target.replicaCodes = row.replicaCodes;
        if (row.country) target.country = row.country;
        if (sets) for (const s of target.sets) if (!s.evs) {
          const evs = sets.find((p) => toID(p.species) === toID(s.species))?.evs;
          if (evs) s.evs = evs;
        }
        merged++;
        log(`  merge ${id} -> ${target.id} (${row.player})`);
        continue;
      }
      if (!row.date) {
        skip(id, 'no date');
        continue;
      }
      teams.push({
        id,
        source: 'victoryroad',
        event: row.event || row.section,
        eventUrl: row.eventUrl ?? undefined,
        date: row.date,
        tier: row.tier,
        placing: row.placing,
        player: row.player,
        country: row.country ?? undefined,
        sourceUrl: vr.VR_URL,
        replicaCodes: row.replicaCodes,
        setsKnown: !!sets,
        sets: sets ?? species,
      });
    }
    info.victoryroad = { fetched: new Date().toISOString(), merged };
  }

  // ---- Legality: a team the app would flag is dropped, never loosened ------------------------------------------
  const legal = [];
  for (const t of teams) {
    if (t.setsKnown) {
      const { sets } = teamSets(t, dex);
      const problems = [...sets.flatMap((s) => setProblems(s, dex)), ...teamProblems(sets, dex)];
      if (problems.length) {
        skip(t.id, `not legal in the dex: ${problems.join(' ')}`);
        continue;
      }
    }
    legal.push(t);
  }

  // Duplicate ids (a team listed twice by one source) keep the first, best-placed copy.
  legal.sort(compareTeams);
  const ids = new Set();
  const out = legal.filter((t) => (ids.has(t.id) ? false : ids.add(t.id)));
  for (const t of out) for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];

  const sourceList = sources
    .filter((s) => info[s])
    .map((s) => ({
      id: s,
      ...SOURCE_INFO[s],
      fetched: info[s].fetched,
      teams: out.filter((t) => t.source === s).length,
      ...(info[s].merged !== undefined ? { merged: info[s].merged } : {}),
    }));
  return { data: { format: FORMAT_NAME, generated: today, sources: sourceList, teams: out }, skipped };
}
