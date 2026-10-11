import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLegalTarget, legalTargets } from '../src/domain/simulation/targets.ts';

const ctx = { foes: ['Incineroar', 'Kingambit'], allies: ['Garchomp'] };

test('U-turn (normal): each foe, then the partner; no keywords', () => {
  assert.deepEqual(legalTargets('normal', ctx), ['Incineroar', 'Kingambit', 'Garchomp']);
  assert.deepEqual(legalTargets('any', ctx), ['Incineroar', 'Kingambit', 'Garchomp']);
  for (const k of ['Both foes', 'All', 'Self']) assert.equal(isLegalTarget('normal', k, 'foe'), false, k);
  assert.equal(isLegalTarget('normal', 'Ally', 'ally'), true);
  assert.equal(isLegalTarget('normal', 'Rillaboom', 'self'), false);
});

test('Heat Wave (allAdjacentFoes): only "Both foes"', () => {
  assert.deepEqual(legalTargets('allAdjacentFoes', ctx), ['Both foes']);
  assert.equal(isLegalTarget('allAdjacentFoes', 'Incineroar', 'foe'), false);
  assert.equal(isLegalTarget('allAdjacentFoes', 'Both foes', 'foe'), true);
});

test('Earthquake (allAdjacent): only "All"', () => {
  assert.deepEqual(legalTargets('allAdjacent', ctx), ['All']);
  assert.equal(isLegalTarget('allAdjacent', 'Both foes', 'foe'), false);
});

test('Protect (self): only "Self"', () => {
  assert.deepEqual(legalTargets('self', ctx), ['Self']);
  assert.equal(isLegalTarget('self', 'Incineroar', 'foe'), false);
});

test('Helping Hand (adjacentAlly): the partner only', () => {
  assert.deepEqual(legalTargets('adjacentAlly', ctx), ['Garchomp']);
  assert.deepEqual(legalTargets('adjacentAlly', { foes: ctx.foes, allies: [] }), ['Ally']);
  assert.equal(isLegalTarget('adjacentAlly', 'Ally', 'ally'), true);
  assert.equal(isLegalTarget('adjacentAlly', 'Incineroar', 'foe'), false);
  assert.equal(isLegalTarget('adjacentAlly', 'Self', 'foe'), false);
});

test('Acupressure (adjacentAllyOrSelf): the user or its partner', () => {
  assert.deepEqual(legalTargets('adjacentAllyOrSelf', ctx), ['Self', 'Garchomp']);
  assert.equal(isLegalTarget('adjacentAllyOrSelf', 'Kingambit', 'foe'), false);
});

test('Tailwind (allySide) and other team-wide moves: "Self"', () => {
  for (const t of ['allySide', 'allyTeam', 'allies']) assert.deepEqual(legalTargets(t, ctx), ['Self'], t);
});

test('Trick Room (all): "All"; Stealth Rock (foeSide): "Both foes"', () => {
  assert.deepEqual(legalTargets('all', ctx), ['All']);
  assert.deepEqual(legalTargets('foeSide', ctx), ['Both foes']);
});

test('Outrage (randomNormal) and Counter (scripted): foes only', () => {
  assert.deepEqual(legalTargets('randomNormal', ctx), ['Incineroar', 'Kingambit']);
  assert.deepEqual(legalTargets('scripted', ctx), ['Incineroar', 'Kingambit']);
  assert.equal(isLegalTarget('randomNormal', 'Garchomp', 'ally'), false);
});

test('a foe no longer on the field stays legal for a single-target move', () => {
  assert.equal(isLegalTarget('normal', 'Amoonguss', 'foe'), true);
});

test('unknown or missing target type: the old permissive list', () => {
  const all = ['Incineroar', 'Kingambit', 'Both foes', 'Garchomp', 'Ally', 'Self', 'All'];
  assert.deepEqual(legalTargets('', ctx), all);
  assert.deepEqual(legalTargets('somethingNew', ctx), all);
  assert.equal(isLegalTarget('', 'Self', 'foe'), true);
});

test('an empty target is always allowed', () => {
  assert.equal(isLegalTarget('self', '', 'foe'), true);
});
