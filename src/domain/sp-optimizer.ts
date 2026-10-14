/**
 * Stat Point optimizer: the fewest Stat Points that make a chosen attack KO a target, or that let a Pokémon survive
 * one. Pure domain code: it works through the same {@link CalcEngine} the turn simulation uses (so the same forms,
 * items, abilities and Champions stat formula), and the UI only collects the inputs and shows the result.
 *
 * Champions rules: at most 32 Stat Points in one stat and 66 in total (see `stats.ts`).
 *
 * Both searches lean on one fact: more points in the attacking stat never lowers the damage, and more points in HP
 * or the defending stat never raise the share of HP an attack takes. So the KO search is a binary search over 0–32
 * points and the survive search walks HP up while it walks the defence down (about 70 calculator calls in total
 * instead of 33 × 33).
 */
import { natureStats, natureWith, emptyStatTable, STAT_KEYS, STAT_LABEL } from './stats.ts';
import { spreadLine } from './dex.ts';
import { parseShowdown } from './showdown.ts';
import { toID } from './strings.ts';
import type { CalcEngine, MoveInfo } from './simulation/engine.ts';
import type { FieldOptions } from './simulation/calc-types.ts';
import type { MonState } from './simulation/state.ts';
import { newMonState, refreshStats } from './simulation/state.ts';
import type { BoostKey, PokemonSet, StatKey, StatTable } from './types.ts';

export const MAX_SP_PER_STAT = 32;
export const MAX_SP_TOTAL = 66;
/** How far past 32 the KO search counts to say how many points an impossible KO would take. */
const OVER_LIMIT = 252;

export type Hits = 1 | 2;
/** Which damage roll decides: the lowest (a guaranteed KO), the average, or the highest (a guaranteed survival). */
export type RollChoice = 'min' | 'avg' | 'max';

/** Field conditions the optimizer passes to the calculator. Tailwind and Trick Room don't change damage, so they're absent. */
export interface OptimizerField {
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  helpingHand?: boolean;
  friendGuard?: boolean;
  /** For moves that hit more than one Pokémon: true (the default) when the move hits two, so the 0.75 spread cut applies. */
  spreadBothTargets?: boolean;
}

export interface OptimizeQuery {
  attacker: PokemonSet;
  defender: PokemonSet;
  move: string;
  field?: OptimizerField;
  hits?: Hits;
  rolls?: RollChoice;
  /** Start from the current Stat Points and only add (true), or start the searched stat(s) from 0 (false). */
  keepCurrent?: boolean;
  /** Also try the nature that raises the searched stat (it is used only when it saves Stat Points). */
  allowNature?: boolean;
  /** A Pokémon holding its Mega Stone is calculated as the Mega (default true). */
  asMega?: boolean;
}

export interface NatureChange {
  from: string;
  to: string;
  raises: BoostKey;
  lowers: BoostKey;
}

export interface OptimizeResult {
  ok: boolean;
  /** The optimised Pokémon's full new spread (or, when not ok, the best one tried). */
  spread: StatTable;
  /** Its spread before. */
  before: StatTable;
  /** `spread - before`, per stat (negative where points had to come out). */
  added: StatTable;
  /** Total Stat Points in the searched stat(s) beyond where the search started. */
  invested: number;
  /** Points taken out of other stats to stay within 66 in total (stat → points removed). */
  removed: Partial<StatTable>;
  /** The nature to use (the current one when unchanged). */
  nature: string;
  natureChange?: NatureChange;
  /** One use of the move, as % of the defender's HP: [lowest roll, highest roll], after and before. */
  rollPct: [number, number];
  beforePct: [number, number];
  /** Chance that `hits` uses of the move KO the defender (0–1), after and before. */
  koChance: number;
  beforeKoChance: number;
  /** The stat(s) searched, e.g. ['atk'] or ['hp', 'def']. */
  stats: StatKey[];
  note: string;
}

// ---- Calculator plumbing ------------------------------------------------------------------------------------

const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);
/** Special moves that hit the target's Defense. */
const HITS_DEF = new Set(['psyshock', 'psystrike', 'secretsword']);

/** The attacker's stat a move uses: Atk, SpA, or Def for Body Press; null for Foul Play (it uses the target's Attack). */
export function attackStat(info: Pick<MoveInfo, 'name' | 'category'>): BoostKey | null {
  const id = toID(info.name);
  if (id === 'foulplay') return null;
  if (id === 'bodypress') return 'def';
  return info.category === 'Special' ? 'spa' : 'atk';
}

/** The defender's stat a move hits: Def, or SpD for special moves other than Psyshock and its kin. */
export function defenceStat(info: Pick<MoveInfo, 'name' | 'category'>): BoostKey {
  return info.category === 'Special' && !HITS_DEF.has(toID(info.name)) ? 'spd' : 'def';
}

export function fieldOptions(info: MoveInfo, field: OptimizerField = {}): FieldOptions {
  const spread = SPREAD_TARGETS.has(info.target);
  return {
    // The calculator applies the 0.75 spread cut only in doubles, so a spread move hitting one Pokémon runs as singles.
    gameType: spread && field.spreadBothTargets === false ? 'Singles' : 'Doubles',
    ...(field.weather ? { weather: field.weather } : {}),
    ...(field.terrain ? { terrain: field.terrain } : {}),
    attackerSide: { isHelpingHand: !!field.helpingHand },
    defenderSide: {
      isReflect: !!field.reflect, isLightScreen: !!field.lightScreen, isAuroraVeil: !!field.auroraVeil, isFriendGuard: !!field.friendGuard,
    },
  };
}

function monFor(engine: CalcEngine, set: PokemonSet, asMega: boolean): MonState {
  const mon = newMonState(engine, set);
  if (!mon.stats) throw new Error(`${set.species || 'That Pokémon'} isn't in the calculator's data.`);
  if (asMega && mon.megaForm) {
    mon.species = mon.megaForm;
    mon.ability = mon.megaAbility || mon.ability;
    mon.mega = true;
    mon.stats = null;
    refreshStats(engine, mon);
    if (!mon.stats) throw new Error(`${mon.megaForm} isn't in the calculator's data.`);
  }
  return mon;
}

/** Sets a Pokémon's Stat Points and nature and recomputes its stats at full HP. */
function respec(engine: CalcEngine, mon: MonState, sp: StatTable, nature: string): void {
  mon.sp = { ...sp };
  mon.set = { ...mon.set, nature };
  mon.stats = null;
  refreshStats(engine, mon);
}

interface Hit { rolls: number[]; hp: number }

const pctOf = (n: number, hp: number): number => Math.round((n / hp) * 1000) / 10;
const rollPct = (h: Hit): [number, number] => [pctOf(Math.min(...h.rolls), h.hp), pctOf(Math.max(...h.rolls), h.hp)];

function pick(rolls: readonly number[], choice: RollChoice): number {
  if (choice === 'min') return Math.min(...rolls);
  if (choice === 'max') return Math.max(...rolls);
  return rolls.reduce((s, r) => s + r, 0) / rolls.length;
}

/** Chance that `hits` uses (each with its own roll) deal at least `hp`. */
export function koChance(rolls: readonly number[], hp: number, hits: Hits): number {
  if (!rolls.length) return 0;
  if (hits === 1) return rolls.filter((r) => r >= hp).length / rolls.length;
  let n = 0;
  for (const a of rolls) for (const b of rolls) if (a + b >= hp) n++;
  return n / (rolls.length * rolls.length);
}

const total = (sp: StatTable): number => STAT_KEYS.reduce((s, k) => s + sp[k], 0);
const diff = (a: StatTable, b: StatTable): StatTable => {
  const out = emptyStatTable();
  for (const k of STAT_KEYS) out[k] = a[k] - b[k];
  return out;
};

/** The attacking stats a Pokémon's own moves use. */
function usedAttackStats(engine: CalcEngine, set: PokemonSet): Set<BoostKey> {
  const used = new Set<BoostKey>();
  for (const m of set.moves) {
    const info = engine.moveInfo(m);
    if (info.category === 'Status') continue;
    const stat = attackStat(info);
    if (stat) used.add(stat);
  }
  return used;
}

/**
 * The nature to try for raising `stat`: it lowers a stat the Pokémon doesn't use (the attacking stat none of its moves
 * use, else the other defence for a defence, or Def / SpD for an attack). Never Speed. Null when the current nature
 * already raises `stat`.
 */
function natureOptions(engine: CalcEngine, set: PokemonSet, stat: BoostKey): string[] {
  if (natureStats(set.nature)?.[0] === stat) return [];
  const used = usedAttackStats(engine, set);
  const unusedAttacks = (['atk', 'spa'] as const).filter((k) => k !== stat && !used.has(k));
  let lowers: BoostKey[];
  if (unusedAttacks.length) lowers = unusedAttacks;
  else if (stat === 'def' || stat === 'spd') lowers = [stat === 'def' ? 'spd' : 'def'];
  else lowers = ['def', 'spd'];
  return lowers.map((down) => natureWith(stat, down)).filter((n): n is string => !!n);
}

/**
 * Takes `over` points out of the stats not being searched, least useful first: an attacking stat its moves don't
 * use, then the smallest allocations, Speed last. Returns what came out of where.
 */
function makeRoom(engine: CalcEngine, set: PokemonSet, sp: StatTable, searched: readonly StatKey[], over: number): Partial<StatTable> {
  const used = usedAttackStats(engine, set);
  const rank = (k: StatKey): number => (k === 'spe' ? 2 : (k === 'atk' || k === 'spa') && !used.has(k) ? 0 : 1);
  const order = STAT_KEYS.filter((k) => !searched.includes(k) && sp[k] > 0).sort((a, b) => rank(a) - rank(b) || sp[a] - sp[b]);
  const removed: Partial<StatTable> = {};
  let left = over;
  for (const k of order) {
    if (left <= 0) break;
    const take = Math.min(sp[k], left);
    sp[k] -= take;
    removed[k] = take;
    left -= take;
  }
  return removed;
}

const removedText = (removed: Partial<StatTable>): string =>
  STAT_KEYS.filter((k) => removed[k]).map((k) => `${removed[k]} ${STAT_LABEL[k]}`).join(', ');

function natureNote(change: NatureChange | undefined): string {
  if (!change) return '';
  const old = natureStats(change.from);
  const lost = old && old[0] !== change.raises ? ` (drops ${change.from}'s +${STAT_LABEL[old[0]]})` : '';
  return ` Nature ${change.from || 'none'} → ${change.to}: +${STAT_LABEL[change.raises]}, −${STAT_LABEL[change.lowers]}${lost}.`;
}

function prepare(engine: CalcEngine, q: OptimizeQuery): { att: MonState; def: MonState; info: MoveInfo; field: FieldOptions } | string {
  const info = engine.moveInfo(q.move);
  if (!q.move || !info.exists) return `${q.move || 'No move'}: not a move the calculator knows.`;
  if (info.category === 'Status') return `${info.name} is a status move: it deals no damage.`;
  const asMega = q.asMega ?? true;
  try {
    return { att: monFor(engine, q.attacker, asMega), def: monFor(engine, q.defender, asMega), info, field: fieldOptions(info, q.field) };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function failed(note: string, set: PokemonSet | null): OptimizeResult {
  const sp = emptyStatTable();
  return {
    ok: false, spread: sp, before: sp, added: emptyStatTable(), invested: 0, removed: {}, nature: set?.nature ?? '',
    rollPct: [0, 0], beforePct: [0, 0], koChance: 0, beforeKoChance: 0, stats: [], note,
  };
}

// ---- KO -----------------------------------------------------------------------------------------------------

/**
 * The fewest added Stat Points in the attacker's attacking stat (Atk or SpA by the move's category; Def for Body
 * Press) so that `hits` uses of the move KO the defender at the chosen roll (default: the lowest, a guaranteed KO).
 * Nothing else changes except, with `allowNature`, a nature that raises that stat when it saves points, and points
 * taken out of other stats when the total would pass 66.
 */
export function minSpToKO(engine: CalcEngine, q: OptimizeQuery): OptimizeResult {
  const hits = q.hits ?? 1;
  const choice = q.rolls ?? 'min';
  const keep = q.keepCurrent ?? true;
  const ready = prepare(engine, q);
  if (typeof ready === 'string') return failed(ready, q.attacker);
  const { att, def, info, field } = ready;
  const stat = attackStat(info);
  if (!stat) return failed(`${info.name} uses the target's Attack: the user's Stat Points don't change its damage.`, q.attacker);

  const before = { ...att.sp };
  const nature0 = att.set.nature;
  const hitWith = (value: number, nature: string): Hit => {
    respec(engine, att, { ...before, [stat]: value }, nature);
    return { rolls: engine.damage(att, def, info.name, field).rolls, hp: def.stats!.hp };
  };
  const kos = (h: Hit): boolean => pick(h.rolls, choice) * hits >= h.hp;
  const start = keep ? before[stat] : 0;

  const beforeHit = hitWith(before[stat], nature0);
  const search = (nature: string): { value: number | null; hit: Hit } => {
    const top = hitWith(MAX_SP_PER_STAT, nature);
    if (start > MAX_SP_PER_STAT || !kos(top)) return { value: null, hit: top };
    let lo = start;
    let hi = MAX_SP_PER_STAT;
    let best = top;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const h = hitWith(mid, nature);
      if (kos(h)) { hi = mid; best = h; } else lo = mid + 1;
    }
    // `best` is the hit at `lo` whenever the loop moved `hi` there; otherwise lo === 32 and `top` is it.
    return { value: lo, hit: best };
  };

  let found = { nature: nature0, ...search(nature0) };
  if (q.allowNature) {
    for (const n of natureOptions(engine, att.set, stat)) {
      const alt = search(n);
      if (alt.value !== null && (found.value === null || alt.value < found.value)) found = { nature: n, ...alt };
    }
  }

  const beforePct = rollPct(beforeHit);
  const beforeKo = koChance(beforeHit.rolls, beforeHit.hp, hits);
  const label = STAT_LABEL[stat];
  const goal = `${hits === 2 ? '2 hits of ' : ''}${info.name} to KO ${def.species}${choice === 'min' ? '' : ` on the ${choice === 'avg' ? 'average' : 'highest'} roll`}`;

  if (found.value === null) {
    // How far off: keep counting past 32 (the formula still works) to say how many points it would take.
    const best = hitWith(MAX_SP_PER_STAT, found.nature);
    const immune = Math.max(...best.rolls) <= 0;
    let need: number | null = null;
    if (!immune && kos(hitWith(OVER_LIMIT, found.nature))) {
      let lo = MAX_SP_PER_STAT + 1;
      let hi = OVER_LIMIT;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (kos(hitWith(mid, found.nature))) hi = mid; else lo = mid + 1; }
      need = lo;
    }
    const spread = { ...before, [stat]: MAX_SP_PER_STAT };
    return {
      ok: false, spread, before, added: diff(spread, before), invested: MAX_SP_PER_STAT - start, removed: {}, nature: found.nature,
      rollPct: rollPct(best), beforePct, koChance: koChance(best.rolls, best.hp, hits), beforeKoChance: beforeKo, stats: [stat],
      note: immune
        ? `${info.name} doesn't affect ${def.species}.`
        : need !== null
        ? `Needs ${need} ${label} for ${goal}: impossible (${MAX_SP_PER_STAT} at most). Best reachable: ${rollPct(best).join('–')}% per hit.`
        : `${goal} isn't reachable with any number of Stat Points. Best reachable: ${rollPct(best).join('–')}% per hit.`,
    };
  }

  const spread = { ...before, [stat]: found.value };
  const over = total(spread) - MAX_SP_TOTAL;
  const removed = over > 0 ? makeRoom(engine, q.attacker, spread, [stat], over) : {};
  const change = found.nature !== nature0 ? { from: nature0, to: found.nature, raises: stat, lowers: natureStats(found.nature)![1] } : undefined;
  const invested = found.value - start;
  const already = keep && invested === 0 && !change;
  return {
    ok: true, spread, before, added: diff(spread, before), invested, removed, nature: found.nature, ...(change ? { natureChange: change } : {}),
    rollPct: rollPct(found.hit), beforePct, koChance: koChance(found.hit.rolls, found.hit.hp, hits), beforeKoChance: beforeKo, stats: [stat],
    note: (already ? `Already enough: the current spread gets ${goal}.` : `${found.value} ${label} gets ${goal}.`)
      + natureNote(change)
      + (over > 0 ? ` That passes ${MAX_SP_TOTAL} in total: take ${removedText(removed)} out.` : ''),
  };
}

// ---- Survive ------------------------------------------------------------------------------------------------

/**
 * The fewest Stat Points across HP and the defence the move hits (Def or SpD), searched together, so the defender
 * survives `hits` uses at the chosen roll (default: the highest, a guaranteed survival). Ties go to more HP.
 */
export function minSpToSurvive(engine: CalcEngine, q: OptimizeQuery): OptimizeResult {
  const hits = q.hits ?? 1;
  const choice = q.rolls ?? 'max';
  const keep = q.keepCurrent ?? true;
  const ready = prepare(engine, q);
  if (typeof ready === 'string') return failed(ready, q.defender);
  const { att, def, info, field } = ready;
  const stat = defenceStat(info);

  const before = { ...def.sp };
  const nature0 = def.set.nature;
  const hitWith = (hp: number, d: number, nature: string): Hit => {
    respec(engine, def, { ...before, hp, [stat]: d }, nature);
    return { rolls: engine.damage(att, def, info.name, field).rolls, hp: def.stats!.hp };
  };
  const lives = (h: Hit): boolean => pick(h.rolls, choice) * hits < h.hp;
  const hp0 = keep ? before.hp : 0;
  const d0 = keep ? before[stat] : 0;

  const beforeHit = hitWith(before.hp, before[stat], nature0);
  const search = (nature: string): { hp: number; d: number; hit: Hit } | null => {
    // Walk HP up; with more HP the defence never needs to be higher, so it only walks down (while it still survives).
    let d = MAX_SP_PER_STAT;
    let best: { hp: number; d: number } | null = null;
    for (let hp = hp0; hp <= MAX_SP_PER_STAT; hp++) {
      if (!best && !lives(hitWith(hp, d, nature))) continue;
      while (d > d0 && lives(hitWith(hp, d - 1, nature))) d--;
      // `<=`: on a tie the later one, with more HP, wins.
      if (!best || (hp - hp0) + (d - d0) <= (best.hp - hp0) + (best.d - d0)) best = { hp, d };
      if (d === d0) break; // more HP from here only costs more
    }
    return best ? { ...best, hit: hitWith(best.hp, best.d, nature) } : null;
  };

  let nature = nature0;
  let found = search(nature0);
  if (q.allowNature) {
    for (const n of natureOptions(engine, def.set, stat)) {
      const alt = search(n);
      const cost = (r: { hp: number; d: number }): number => (r.hp - hp0) + (r.d - d0);
      if (alt && (!found || cost(alt) < cost(found))) { found = alt; nature = n; }
    }
  }

  const beforePct = rollPct(beforeHit);
  const beforeKo = koChance(beforeHit.rolls, beforeHit.hp, hits);
  const label = STAT_LABEL[stat];
  const goal = `${hits === 2 ? '2 hits of ' : ''}${att.species}'s ${info.name}${choice === 'max' ? '' : ` on the ${choice === 'avg' ? 'average' : 'lowest'} roll`}`;

  if (!found) {
    const worst = hitWith(MAX_SP_PER_STAT, MAX_SP_PER_STAT, nature0);
    const spread = { ...before, hp: MAX_SP_PER_STAT, [stat]: MAX_SP_PER_STAT };
    return {
      ok: false, spread, before, added: diff(spread, before), invested: (MAX_SP_PER_STAT - hp0) + (MAX_SP_PER_STAT - d0), removed: {}, nature: nature0,
      rollPct: rollPct(worst), beforePct, koChance: koChance(worst.rolls, worst.hp, hits), beforeKoChance: beforeKo, stats: ['hp', stat],
      note: `Can't survive ${goal}: even ${MAX_SP_PER_STAT} HP / ${MAX_SP_PER_STAT} ${label}${q.allowNature ? ' with a nature change' : ''} takes ${rollPct(worst).join('–')}% per hit.`,
    };
  }

  const spread = { ...before, hp: found.hp, [stat]: found.d };
  const over = total(spread) - MAX_SP_TOTAL;
  const removed = over > 0 ? makeRoom(engine, q.defender, spread, ['hp', stat], over) : {};
  const change = nature !== nature0 ? { from: nature0, to: nature, raises: stat, lowers: natureStats(nature)![1] } : undefined;
  const invested = (found.hp - hp0) + (found.d - d0);
  const already = keep && invested === 0 && !change;
  return {
    ok: true, spread, before, added: diff(spread, before), invested, removed, nature, ...(change ? { natureChange: change } : {}),
    rollPct: rollPct(found.hit), beforePct, koChance: koChance(found.hit.rolls, found.hit.hp, hits), beforeKoChance: beforeKo, stats: ['hp', stat],
    note: (already ? `Already enough: the current spread survives ${goal}.` : `${found.hp} HP / ${found.d} ${label} survives ${goal}.`)
      + natureNote(change)
      + (over > 0 ? ` That passes ${MAX_SP_TOTAL} in total: take ${removedText(removed)} out.` : ''),
  };
}

// ---- Targets and pastes ---------------------------------------------------------------------------------------

export type Preset = 'offence' | 'bulk' | 'none';
export const PRESET_LABEL: Readonly<Record<Preset, string>> = { offence: 'Max offence', bulk: 'Max bulk', none: 'Uninvested' };

/**
 * A stand-in set for a species typed by name. `category` is the move's category: "max offence" puts 32 points in the
 * attacking stat it uses with the nature for it, "max bulk" puts 32 in HP and the defence it hits; "uninvested" has
 * none, with a neutral nature. No item; the calculator gives the species its usual ability.
 */
export function presetSet(species: string, preset: Preset, category: 'Physical' | 'Special'): PokemonSet {
  const special = category === 'Special';
  const spec: Record<Preset, { evs: string; nature: string }> = {
    offence: special ? { evs: '2 HP / 32 SpA / 32 Spe', nature: 'Modest' } : { evs: '2 HP / 32 Atk / 32 Spe', nature: 'Adamant' },
    bulk: special ? { evs: '32 HP / 2 Def / 32 SpD', nature: 'Calm' } : { evs: '32 HP / 32 Def / 2 SpD', nature: 'Bold' },
    none: { evs: '', nature: 'Serious' },
  };
  return { nickname: '', species, gender: '', item: '', ability: '', level: 50, nature: spec[preset].nature, evs: spec[preset].evs, ivs: '', moves: [], extra: [] };
}

/** The paste's own spread line for a table: "EVs: 20 HP / 25 Atk" (Champions pastes label Stat Points as EVs). */
export const evsLine = (sp: StatTable): string => (total(sp) > 0 ? `EVs: ${spreadLine(sp)}` : '');

/**
 * Rewrites the spread (and, when given, the nature) of the `index`-th Pokémon in a paste, leaving every other line,
 * blank line and line ending exactly as it was. A missing EVs / Nature line is added where Showdown writes it: after
 * the Ability / Level / other header lines, before the moves.
 */
export function rewriteSpread(paste: string, index: number, sp: StatTable, nature?: string): string {
  const lines = paste.split('\n');
  // Blocks of non-blank lines, as the paste parser splits them.
  const blocks: { from: number; to: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue;
    const from = i;
    while (i + 1 < lines.length && lines[i + 1]!.trim()) i++;
    blocks.push({ from, to: i });
  }
  const mons = blocks.filter((b) => parseShowdown(lines.slice(b.from, b.to + 1).join('\n')).length === 1);
  const block = mons[index];
  if (!block) throw new Error(`There is no Pokémon number ${index + 1} in this paste.`);

  const eol = (line: string): string => (line.endsWith('\r') ? '\r' : '');
  const body = lines.slice(block.from, block.to + 1);
  const ending = eol(body[0]!);
  const evs = evsLine(sp);
  const isEvs = (l: string): boolean => /^\s*EVs?:/i.test(l);
  const isNature = (l: string): boolean => /^\s*\w+\s+Nature\s*$/i.test(l);
  const isMove = (l: string): boolean => /^\s*[-–•]/.test(l);
  const firstMove = (): number => { const m = body.findIndex(isMove); return m < 0 ? body.length : m; };

  const at = body.findIndex(isEvs);
  if (at >= 0) {
    if (evs) body[at] = evs + eol(body[at]!);
    else body.splice(at, 1);
  } else if (evs) {
    const natureAt = body.findIndex(isNature);
    body.splice(natureAt >= 0 ? natureAt : firstMove(), 0, evs + ending);
  }
  if (nature) {
    const natureAt = body.findIndex(isNature);
    const line = `${nature} Nature`;
    if (natureAt >= 0) body[natureAt] = line + eol(body[natureAt]!);
    else {
      const evsAt = body.findIndex(isEvs);
      body.splice(evsAt >= 0 ? evsAt + 1 : firstMove(), 0, line + ending);
    }
  }
  return [...lines.slice(0, block.from), ...body, ...lines.slice(block.to + 1)].join('\n');
}
