/**
 * Shared pieces of the top-teams refresh (scripts/fetch-teams.mjs): HTML helpers, a polite fetcher, and the name
 * resolver that turns whatever a source calls a Pokémon, item, ability or move into the dex's own display name.
 *
 * Pure apart from `politeFetch`, so tests can run every parser on saved fixtures.
 */

export const USER_AGENT = 'vgc-gameplan-planner/1.0 (+https://vgcplanner.app; teams refresh)';
export const FORMAT_ID = 'gen9championsvgc2026regmc';

/** Showdown's ID, after dropping accents so "Naïve" and "Flabébé" match ("naive", "flabebe"). */
export const toID = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Decodes the HTML entities these sites use (a few named ones, plus numeric). */
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
    return all;
  });
}

/** Text content of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export const textOf = (html) =>
  decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "1st" / "22nd" / "13th" -> 1 / 22 / 13; anything else -> null. */
export function ordinal(text) {
  const m = String(text ?? '').match(/(\d+)\s*(?:st|nd|rd|th)\b/i);
  return m ? Number(m[1]) : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Index of an English month name or a 3+ letter prefix of one ("Sept", "Oct"), or -1. */
export function monthIndex(word) {
  const w = String(word ?? '').toLowerCase();
  return w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)) && m.startsWith(w)) : -1;
}
export const isoDate = (y, mIndex, d) => `${y}-${String(mIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "3rd October 2026" -> "2026-10-03"; null when it isn't such a date. */
export function dayMonthYear(text) {
  const m = String(text ?? '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m || monthIndex(m[2]) < 0) return null;
  return isoDate(Number(m[3]), monthIndex(m[2]), Number(m[1]));
}

// ---- Tiers and ordering ---------------------------------------------------------------------------------------

export const TIERS = ['worlds', 'international', 'regional', 'special', 'online', 'ranked'];

/** The tier of an official event from its name (Limitless and Victory Road both use the TPCi names), or null. */
export function officialTier(event) {
  const e = String(event ?? '');
  if (/world championships?|\bworlds\b/i.test(e)) return 'worlds';
  if (/international|\b(?:NA|EU|LA|OC)IC\b/i.test(e)) return 'international';
  if (/regional/i.test(e)) return 'regional';
  if (/special event/i.test(e)) return 'special';
  return null;
}

/** Tier rank, then placing (unknown last), then newest first, then id so the order is stable. */
export function compareTeams(a, b) {
  return (
    TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) ||
    (a.placing ?? Infinity) - (b.placing ?? Infinity) ||
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ---- Names ----------------------------------------------------------------------------------------------------

const REGIONS = { hisuian: 'hisui', alolan: 'alola', galarian: 'galar', paldean: 'paldea' };
const NOISE = new Set(['breed', 'form', 'forme', 'style', 'mode']);

/**
 * Resolves names against src/data/champions-mc.json the way scripts/fetch-usage.mjs does (by ID; a Mega becomes
 * its base species plus its stone) and also understands the spellings the team sites use: "Hisuian Arcanine",
 * "Paldean Tauros Aqua Breed", "Female Indeedee", "Indeedee ♀", "Eternal Flower Floette", "Heat Rotom",
 * "Garchomp Mega Z", "Meowstic F Mega", and cosmetic forms the dex doesn't split ("Alcremie Rainbow Swirl").
 */
export function makeResolver(dex, usage = null) {
  const speciesById = new Map(dex.species.map((s) => [s.id, s]));
  const megaOf = new Map(); // "garchompmegaz" -> { species: "Garchomp", item: "Garchompite Z" }
  for (const s of dex.species) for (const m of s.megas ?? []) megaOf.set(toID(m.name), { species: s.name, item: m.item });
  const itemById = new Map(dex.items.map((i) => [toID(i.name), i.name]));
  const abilityById = new Map(Object.keys(dex.abilities).map((a) => [toID(a), a]));
  const natureById = new Map(dex.natures.map((n) => [toID(n.name), n.name]));

  const byId = (id) => {
    if (speciesById.has(id)) return { species: speciesById.get(id).name };
    if (megaOf.has(id)) return { ...megaOf.get(id) };
    return null;
  };

  function candidates(raw) {
    const name = String(raw ?? '').replace(/♀/g, ' F').replace(/♂/g, ' ').replace(/[-_]/g, ' ').trim();
    const words = name.split(/\s+/).filter((w) => w && !NOISE.has(w.toLowerCase()));
    const out = [words.join('')];
    if (words.length > 1) {
      const [first, ...rest] = words;
      const region = REGIONS[first.toLowerCase()];
      if (region) out.push([rest[0], region, ...rest.slice(1)].join(''));
      if (/^female$/i.test(first)) out.push(rest.join('') + 'f');
      if (/^male$/i.test(first)) out.push(rest.join(''));
      out.push(words.at(-1) + words.slice(0, -1).join('')); // "Heat Rotom" -> rotomheat
      out.push(words.at(-1) + first); // "Eternal Flower Floette" -> floetteeternal
      // Cosmetic forms the dex doesn't split ("Alcremie Rainbow Swirl", "Pyroar F"): drop trailing words.
      for (let n = words.length - 1; n >= 1; n--) out.push(words.slice(0, n).join(''));
    }
    return out.map(toID);
  }

  return {
    /** `{ species, item? }` (item: the Mega Stone when the name was a Mega), or null. */
    species(raw) {
      for (const id of candidates(raw)) {
        const hit = byId(id);
        if (hit) return hit;
      }
      return null;
    },
    /** The species a Mega Stone belongs to ("Floettite" -> "Floette-Eternal"), or null. */
    stoneOwner(raw) {
      const id = toID(raw);
      for (const m of megaOf.values()) if (toID(m.item) === id) return m.species;
      return null;
    },
    /**
     * Pastes exported from a Mega often carry the Mega's ability ("Charizard @ Charizardite Y / Ability: Drought").
     * The base form can't have it, so it becomes the base form's most used ability in Smogon usage (its first
     * ability without usage). Returns that ability, or null when `ability` isn't such a case.
     */
    baseAbilityForMega(species, item, ability) {
      const s = speciesById.get(toID(species));
      if (!s || s.abilities.some((a) => toID(a) === toID(ability))) return null;
      const mega = (s.megas ?? []).find((m) => toID(m.item) === toID(item));
      if (!mega || toID(mega.ability) !== toID(ability)) return null;
      const used = new Map();
      for (const u of usage?.mons ?? []) if (toID(u.species) === s.id) for (const [a, pct] of u.abilities) used.set(toID(a), (used.get(toID(a)) ?? 0) + pct);
      return [...s.abilities].sort((a, b) => (used.get(toID(b)) ?? 0) - (used.get(toID(a)) ?? 0))[0] ?? null;
    },
    item: (raw) => itemById.get(toID(raw)) ?? null,
    ability: (raw) => abilityById.get(toID(raw)) ?? null,
    move: (raw) => dex.moves[toID(raw)]?.name ?? null,
    nature: (raw) => natureById.get(toID(raw)) ?? null,
  };
}

/**
 * One raw set ({ species, item, ability, nature, moves, evs? }) in the dex's names. Returns `{ set }`, or
 * `{ error }` naming the first thing that doesn't resolve. A Mega species name without an item gets its stone.
 * `note` says when a Mega's ability was written as its base form's.
 */
export function normaliseSet(raw, resolve) {
  let sp = resolve.species(raw.species);
  // "Floette @ Floettite": the stone names the form the dex knows (Floette-Eternal), so the stone decides.
  const owner = sp ? null : resolve.stoneOwner(raw.item);
  if (owner && toID(owner).startsWith(toID(raw.species))) sp = { species: owner };
  if (!sp) return { error: `unknown species "${raw.species}"` };
  const set = { species: sp.species, item: '', ability: '', nature: '', moves: [] };
  let note;
  const itemRaw = String(raw.item ?? '').trim();
  if (itemRaw) {
    const item = resolve.item(itemRaw);
    if (!item) return { error: `${sp.species}: unknown item "${itemRaw}"` };
    set.item = item;
  } else if (sp.item) set.item = sp.item;
  const abilityRaw = String(raw.ability ?? '').trim();
  if (abilityRaw) {
    const ability = resolve.ability(abilityRaw);
    if (!ability) return { error: `${sp.species}: unknown ability "${abilityRaw}"` };
    set.ability = ability;
    const base = resolve.baseAbilityForMega(set.species, set.item, ability);
    if (base) {
      set.ability = base;
      note = `${sp.species}: Mega ability ${ability} written as ${base}`;
    }
  }
  const natureRaw = String(raw.nature ?? '').trim();
  if (natureRaw) {
    const nature = resolve.nature(natureRaw);
    if (!nature) return { error: `${sp.species}: unknown nature "${natureRaw}"` };
    set.nature = nature;
  }
  // Limitless shows an empty move slot as "-".
  for (const m of (raw.moves ?? []).filter((x) => x && x.trim() !== '-')) {
    const move = resolve.move(m);
    if (!move) return { error: `${sp.species}: unknown move "${m}"` };
    set.moves.push(move);
  }
  if (raw.evs) set.evs = raw.evs;
  return note ? { set, note } : { set };
}

// ---- Fetching -------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

/**
 * GET with the project's User-Agent: sequential, at least `gap` ms between requests, a 20 s timeout, and retries
 * with backoff on 429/5xx and network errors (a 429's Retry-After is honoured). Returns the body text, or throws.
 */
export async function politeFetch(url, { gap = 250, retries = 4, timeout = 20_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      if (attempt >= retries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}
