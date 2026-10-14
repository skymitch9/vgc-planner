/**
 * The Stat Point optimizer against the real calculator. The boundary numbers were worked by hand with the damage
 * formula (level 50, Champions stats) and then checked against the calculator; the search results are also checked
 * against direct calculator calls one point either side, and the survive search against a full 33 × 33 brute force.
 *
 * Hand check (Jolly Garchomp, 0 Atk → Atk 150; Gengar, 32 HP → HP 167, Def 80; Earthquake into both foes):
 *   floor(floor(22 × 100 × 150 / 80) / 50) + 2 = 84 → ×0.75 spread = 63 → lowest roll 53 → STAB 79 → ×2 = 158 (94.6%).
 *   6 Atk (156): 87 → 65 → 55 → 82 → 164 < 167.   7 Atk (157): 88 → 66 → 56 → 84 → 168 ≥ 167, a guaranteed OHKO.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as calc from '@smogon/calc';
import { parseShowdown } from '../src/domain/showdown.ts';
import type { CalcLib } from '../src/domain/simulation/calc-types.ts';
import { createEngine } from '../src/domain/simulation/engine.ts';
import { newMonState, refreshStats } from '../src/domain/simulation/state.ts';
import { evsLine, fieldOptions, koChance, minSpToKO, minSpToSurvive, presetSet, rewriteSpread } from '../src/domain/sp-optimizer.ts';
import { readSpread } from '../src/domain/stats.ts';
import type { PokemonSet, StatTable } from '../src/domain/types.ts';

const engine = createEngine(calc as unknown as CalcLib);
const set = (text: string): PokemonSet => parseShowdown(text)[0]!;
const chomp = (evs: string, nature = 'Jolly'): PokemonSet =>
  set(`Garchomp\nAbility: Rough Skin\nEVs: ${evs}\n${nature} Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect`);
const GENGAR = set('Gengar\nAbility: Cursed Body\nEVs: 32 HP\nTimid Nature');
const ARCANINE = set('Arcanine\nAbility: Intimidate\nJolly Nature');
const LO_CHOMP = set('Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 32 Atk\nAdamant Nature\n- Earthquake');
const incin = (evs = ''): PokemonSet => set(`Incineroar\nAbility: Intimidate\n${evs ? `EVs: ${evs}\n` : ''}Careful Nature\n- Fake Out\n- Flare Blitz\n- Knock Off`);

/** Damage rolls straight from the calculator for an attacker given Stat Points / nature. */
function rollsFor(attacker: PokemonSet, sp: Partial<StatTable>, defender: PokemonSet, move: string, opts: { nature?: string; spreadBothTargets?: boolean } = {}): { rolls: number[]; hp: number } {
  const a = newMonState(engine, { ...attacker, nature: opts.nature ?? attacker.nature });
  a.sp = { ...a.sp, ...sp };
  a.stats = null;
  refreshStats(engine, a);
  const d = newMonState(engine, defender);
  const field = fieldOptions(engine.moveInfo(move), { spreadBothTargets: opts.spreadBothTargets ?? true });
  return { rolls: engine.damage(a, d, move, field).rolls, hp: d.stats!.hp };
}

test('KO: the hand-worked boundary — 7 Atk is the fewest for a guaranteed OHKO, 6 is not', () => {
  const r = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: GENGAR, move: 'Earthquake' });
  assert.equal(r.ok, true, r.note);
  assert.equal(r.spread.atk, 7);
  assert.deepEqual(r.added, { hp: 0, atk: 7, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.deepEqual(r.beforePct, [94.6, 112.6]);
  assert.deepEqual(r.rollPct, [100.6, 118.6]);
  assert.equal(r.koChance, 1);
  assert.equal(r.nature, 'Jolly');
  assert.equal(r.natureChange, undefined);
  const at6 = rollsFor(chomp('2 HP / 32 Spe'), { atk: 6 }, GENGAR, 'Earthquake');
  const at7 = rollsFor(chomp('2 HP / 32 Spe'), { atk: 7 }, GENGAR, 'Earthquake');
  assert.deepEqual([at6.hp, Math.min(...at6.rolls), Math.min(...at7.rolls)], [167, 164, 168]);
});

test('KO: 0 Stat Points can already be enough, and keepCurrent=false searches the stat from 0', () => {
  const none = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: set('Gengar\nAbility: Cursed Body\nTimid Nature'), move: 'Earthquake' });
  assert.equal(none.ok, true);
  assert.equal(none.invested, 0);
  assert.match(none.note, /Already enough/);
  // 20 Atk today; from 0 the answer is the same 7, so 13 come out.
  const fresh = minSpToKO(engine, { attacker: chomp('2 HP / 20 Atk / 32 Spe'), defender: GENGAR, move: 'Earthquake', keepCurrent: false });
  assert.equal(fresh.spread.atk, 7);
  assert.equal(fresh.added.atk, -13);
  // Kept, it is already enough.
  const kept = minSpToKO(engine, { attacker: chomp('2 HP / 20 Atk / 32 Spe'), defender: GENGAR, move: 'Earthquake', keepCurrent: true });
  assert.equal(kept.spread.atk, 20);
});

test('KO: past 32 points it says how many it would take, and reports the best reachable damage', () => {
  const r = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: ARCANINE, move: 'Earthquake' });
  assert.equal(r.ok, false);
  assert.equal(r.spread.atk, 32);
  assert.match(r.note, /^Needs 46 Atk for Earthquake to KO Arcanine: impossible/);
  assert.deepEqual(r.rollPct, [92.1, 110.3]);
  const immune = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: set('Rotom-Wash\nAbility: Levitate\nModest Nature'), move: 'Earthquake' });
  assert.equal(immune.ok, false);
  assert.match(immune.note, /doesn't affect Rotom-Wash/);
});

test('KO: a nature change that saves Stat Points (Jolly cannot, Adamant needs 29 and lowers the unused SpA)', () => {
  const r = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: ARCANINE, move: 'Earthquake', allowNature: true });
  assert.equal(r.ok, true, r.note);
  assert.equal(r.spread.atk, 29);
  assert.equal(r.nature, 'Adamant');
  assert.deepEqual(r.natureChange, { from: 'Jolly', to: 'Adamant', raises: 'atk', lowers: 'spa' });
  assert.match(r.note, /drops Jolly's \+Spe/);
  // Checked directly: Adamant 29 KOs on the lowest roll, Adamant 28 does not.
  const at = (atk: number): { rolls: number[]; hp: number } => rollsFor(chomp('2 HP / 32 Spe'), { atk }, ARCANINE, 'Earthquake', { nature: 'Adamant' });
  assert.ok(Math.min(...at(29).rolls) >= at(29).hp);
  assert.ok(Math.min(...at(28).rolls) < at(28).hp);
  // Where the current nature already works, the change is only taken when it saves points: Gengar needs 7 (Jolly) or 0 (Adamant).
  const g = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: GENGAR, move: 'Earthquake', allowNature: true });
  assert.deepEqual([g.spread.atk, g.nature], [0, 'Adamant']);
});

test('KO: a spread move into two foes takes the 0.75 cut; into one it does not', () => {
  const both = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: GENGAR, move: 'Earthquake' });
  const one = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: GENGAR, move: 'Earthquake', field: { spreadBothTargets: false } });
  assert.deepEqual([both.spread.atk, one.spread.atk], [7, 0]);
  assert.deepEqual(one.beforePct, [126.9, 150.9]);
  // A single-target move ignores the option.
  const claw = (spreadBothTargets: boolean): number[] => rollsFor(chomp('2 HP / 32 Spe'), {}, GENGAR, 'Dragon Claw', { spreadBothTargets }).rolls;
  assert.deepEqual(claw(true), claw(false));
});

test('KO: past 66 in total, points come out of other stats — smallest first, Speed last', () => {
  const r = minSpToKO(engine, { attacker: chomp('32 HP / 2 Def / 32 Spe'), defender: GENGAR, move: 'Earthquake' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.spread, { hp: 27, atk: 7, def: 0, spa: 0, spd: 0, spe: 32 });
  assert.deepEqual(r.removed, { def: 2, hp: 5 });
  assert.match(r.note, /passes 66 in total: take 5 HP, 2 Def out/);
  const sum = Object.values(r.spread).reduce((a, b) => a + b, 0);
  assert.equal(sum, 66);
});

test('KO: 2 hits and roll choice', () => {
  const two = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: ARCANINE, move: 'Earthquake', hits: 2 });
  assert.equal(two.ok, true);
  assert.equal(two.spread.atk, 0);
  assert.equal(two.koChance, 1);
  const avg = minSpToKO(engine, { attacker: chomp('2 HP / 32 Spe'), defender: GENGAR, move: 'Earthquake', rolls: 'avg' });
  assert.ok(avg.spread.atk < 7, `average roll needs fewer than the guaranteed 7, got ${avg.spread.atk}`);
});

test('Survive: HP + Def searched jointly beats HP alone, and matches a 33 × 33 brute force', () => {
  const r = minSpToSurvive(engine, { defender: incin(), attacker: LO_CHOMP, move: 'Earthquake', keepCurrent: false });
  assert.equal(r.ok, true, r.note);
  assert.deepEqual([r.spread.hp, r.spread.def], [13, 32]);
  assert.equal(r.invested, 45);
  assert.deepEqual(r.beforePct, [116.5, 139.4]);
  assert.equal(r.koChance, 0);

  const d = newMonState(engine, incin());
  const a = newMonState(engine, LO_CHOMP);
  const field = fieldOptions(engine.moveInfo('Earthquake'));
  let best: [number, number] | null = null;
  const hpAlone: number[] = [];
  for (let hp = 0; hp <= 32; hp++) {
    for (let def = 0; def <= 32; def++) {
      d.sp = { hp, atk: 0, def, spa: 0, spd: 0, spe: 0 };
      d.stats = null;
      refreshStats(engine, d);
      const lives = Math.max(...engine.damage(a, d, 'Earthquake', field).rolls) < d.stats!.hp;
      if (!lives) continue;
      if (def === 0) hpAlone.push(hp);
      if (!best || hp + def < best[0] + best[1] || (hp + def === best[0] + best[1] && hp > best[0])) best = [hp, def];
    }
  }
  assert.deepEqual(hpAlone, [], 'HP alone never survives');
  assert.deepEqual(best, [13, 32]);
});

test('Survive: keeping the current spread only adds, and a nature change can save points', () => {
  const kept = minSpToSurvive(engine, { defender: incin('32 HP / 2 Def'), attacker: LO_CHOMP, move: 'Earthquake' });
  assert.deepEqual([kept.spread.hp, kept.spread.def, kept.invested], [32, 22, 20]);
  const nat = minSpToSurvive(engine, { defender: incin(), attacker: LO_CHOMP, move: 'Earthquake', keepCurrent: false, allowNature: true });
  assert.deepEqual([nat.spread.hp, nat.spread.def, nat.nature], [0, 31, 'Impish']);
  assert.equal(nat.natureChange?.lowers, 'spa');
});

test('koChance counts each use with its own roll', () => {
  assert.equal(koChance([1, 2, 3, 4], 3, 1), 0.5);
  assert.equal(koChance([1, 2], 3, 2), 3 / 4);
});

test('presets fill the stat the move uses', () => {
  assert.deepEqual([presetSet('Gengar', 'bulk', 'Special').evs, presetSet('Gengar', 'bulk', 'Special').nature], ['32 HP / 2 Def / 32 SpD', 'Calm']);
  assert.equal(readSpread(presetSet('Garchomp', 'offence', 'Physical').evs).atk, 32);
  assert.equal(presetSet('Garchomp', 'none', 'Physical').evs, '');
});

test('rewriteSpread replaces only the chosen Pokémon’s spread (and nature) — nothing else moves', () => {
  const paste = [
    '=== [gen9] Team ===', '', 'Garchomp @ Life Orb  ', 'Ability: Rough Skin', 'Tera Type: Steel', 'EVs: 2 HP / 32 Spe', 'Jolly Nature', '- Earthquake', '- Protect',
    '', '', 'Gengar', 'Ability: Cursed Body', 'EVs: 32 HP', 'Timid Nature', '- Shadow Ball', '',
  ].join('\r\n');
  const out = rewriteSpread(paste, 0, { hp: 2, atk: 7, def: 0, spa: 0, spd: 0, spe: 32 });
  assert.equal(out, paste.replace('EVs: 2 HP / 32 Spe', 'EVs: 2 HP / 7 Atk / 32 Spe'));
  const withNature = rewriteSpread(paste, 1, { hp: 32, atk: 0, def: 0, spa: 4, spd: 0, spe: 0 }, 'Modest');
  assert.equal(withNature, paste.replace('EVs: 32 HP\r\nTimid', 'EVs: 32 HP / 4 SpA\r\nModest'));
  // A set without EVs / Nature lines gets them before its moves.
  const bare = 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n\nRaichu\n- Surf\n';
  assert.equal(rewriteSpread(bare, 1, { hp: 0, atk: 0, def: 0, spa: 10, spd: 0, spe: 0 }, 'Timid'), 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n\nRaichu\nEVs: 10 SpA\nTimid Nature\n- Surf\n');
  assert.equal(evsLine({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }), '');
  assert.throws(() => rewriteSpread(bare, 2, { hp: 1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }), /no Pokémon number 3/);
  // The parsed result is the same team with the new spread.
  assert.equal(parseShowdown(out)[0]!.evs, '2 HP / 7 Atk / 32 Spe');
  assert.equal(parseShowdown(out)[0]!.extra[0], 'Tera Type: Steel');
});
