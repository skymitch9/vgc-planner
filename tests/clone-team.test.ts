import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyNameFor } from '../src/domain/bulk-import.ts';
import { LIMITS } from '../src/domain/codec.ts';
import { cloneTeam, newNode, newPlan, newTab, newTeam } from '../src/domain/model.ts';
import type { FlowNode, Team } from '../src/domain/types.ts';

const PASTE = 'Rillaboom @ Assault Vest\nAbility: Grassy Surge\n- Fake Out\n\nGarchomp @ Sitrus Berry\nAbility: Rough Skin\n- Earthquake\n';

/** A team with two gameplans; the first has two tabs and nested turns. */
function sample(): Team {
  const team = newTeam('Rain offense', PASTE);
  team.estimatedSpreads = ['Garchomp'];
  const plan = newPlan('vs Sun', 'Torkoal\n- Eruption\n');
  plan.opponent.name = 'Sun';
  plan.tabs[0]!.selection.me.lead = ['Rillaboom', 'Garchomp'];
  plan.tabs[0]!.children = [newNode({
    title: 'Turn 1', tags: ['safe'],
    actions: [{ side: 'me', mon: 'Rillaboom', kind: 'move', move: 'Fake Out', target: 'Torkoal' }],
    children: [newNode({ title: 'Turn 2', children: [newNode({ title: 'Turn 3' })] }), newNode({ title: 'Turn 2b' })],
  })];
  plan.tabs.push(newTab('Plan 2'));
  team.plans.push(plan, newPlan('vs Rain'));
  return team;
}

const nodeIds = (list: readonly FlowNode[]): string[] => list.flatMap((n) => [n.id, ...nodeIds(n.children)]);
const allIds = (team: Team): string[] => [team.id, ...team.plans.flatMap((p) => [p.id, ...p.tabs.flatMap((t) => [t.id, ...nodeIds(t.children)])])];
/** The team with every id blanked, to compare content only. */
const withoutIds = (team: Team): unknown => JSON.parse(JSON.stringify(team, (key, value: unknown) => (key === 'id' ? '' : value)));

test('a copy without gameplans has a new id, the given name, the paste and no gameplans', () => {
  const team = sample();
  const copy = cloneTeam(team, { name: 'Rain offense (copy)', withPlans: false });
  assert.notEqual(copy.id, team.id);
  assert.equal(copy.name, 'Rain offense (copy)');
  assert.equal(copy.paste, team.paste);
  assert.deepEqual(copy.plans, []);
  assert.equal(team.plans.length, 2);
});

test('a copy with gameplans holds the same content under fresh ids everywhere', () => {
  const team = sample();
  const copy = cloneTeam(team, { name: team.name, withPlans: true });
  assert.deepEqual(withoutIds(copy), withoutIds(team));
  assert.deepEqual(copy.plans.map((p) => p.name), ['vs Sun', 'vs Rain']);
  const before = allIds(team);
  const after = allIds(copy);
  assert.equal(before.length, 10);
  assert.equal(after.length, before.length);
  assert.equal(new Set(after).size, after.length);
  assert.deepEqual(after.filter((id) => before.includes(id)), []);
});

test('the copy shares nothing with the original', () => {
  const team = sample();
  const snapshot = structuredClone(team);
  const copy = cloneTeam(team, { name: 'Copy', withPlans: true });
  copy.paste = 'Pelipper\n- Protect\n';
  copy.estimatedSpreads!.push('Rillaboom');
  const plan = copy.plans[0]!;
  plan.name = 'changed';
  plan.opponent.paste = '';
  plan.opponent.name = 'changed';
  plan.tabs[0]!.name = 'changed';
  plan.tabs[0]!.selection.me.lead[0] = null;
  const turn = plan.tabs[0]!.children[0]!;
  turn.title = 'changed';
  turn.tags.push('risky');
  turn.actions[0]!.move = 'Grassy Glide';
  turn.children[0]!.children.pop();
  turn.children.pop();
  plan.tabs.pop();
  copy.plans.pop();
  assert.deepEqual(team, snapshot);
});

test('estimated spread labels are copied, and left out when there are none', () => {
  const team = sample();
  const copy = cloneTeam(team, { name: 'Copy', withPlans: false });
  assert.deepEqual(copy.estimatedSpreads, ['Garchomp']);
  assert.notEqual(copy.estimatedSpreads, team.estimatedSpreads);
  delete team.estimatedSpreads;
  assert.equal('estimatedSpreads' in cloneTeam(team, { name: 'Copy', withPlans: false }), false);
});

test('a copy is named "(copy)", then "(copy 2)", "(copy 3)"..., compared without case', () => {
  assert.equal(copyNameFor('Rain', ['Rain']), 'Rain (copy)');
  assert.equal(copyNameFor('Rain', ['Rain', 'rain (COPY)']), 'Rain (copy 2)');
  assert.equal(copyNameFor('Rain', ['Rain', 'Rain (copy)', 'Rain (copy 2)']), 'Rain (copy 3)');
  assert.equal(copyNameFor('Rain', ['Rain', 'Rain (copy 2)']), 'Rain (copy)');
  assert.equal(copyNameFor('Rain (copy)', ['Rain', 'Rain (copy)']), 'Rain (copy) (copy)');
  assert.equal(copyNameFor('  ', []), 'Team (copy)');
  assert.ok(copyNameFor('x'.repeat(LIMITS.nameLength), []).length <= LIMITS.nameLength);
});
