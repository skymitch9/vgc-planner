import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileLibrary, snapshotLibrary } from '../src/domain/library-sync.ts';
import { newPlan, newTeam } from '../src/domain/model.ts';
import type { Library } from '../src/domain/types.ts';

/** Two tabs that both loaded `saved`: each gets its own copy, as each tab parses storage itself. */
function twoTabs(saved: Library): { base: ReturnType<typeof snapshotLibrary>; local: Library; stored: Library } {
  return { base: snapshotLibrary(saved), local: structuredClone(saved), stored: structuredClone(saved) };
}
const names = (lib: Library): string[] => lib.teams.map((t) => t.name);

function sample(): Library {
  const a = newTeam('Alpha', 'Rillaboom'); a.plans.push(newPlan('vs Sun'), newPlan('vs Rain'));
  const b = newTeam('Beta', 'Incineroar');
  return { teams: [a, b] };
}

test('nothing changed anywhere: nothing to do', () => {
  const { base, local, stored } = twoTabs(sample());
  const r = reconcileLibrary(base, local, stored);
  assert.equal(r.changed, false);
  assert.equal(r.unsaved, false);
});

test('stored wins for records this tab has not touched', () => {
  const { base, local, stored } = twoTabs(sample());
  stored.teams[0]!.name = 'Alpha (renamed elsewhere)';
  stored.teams[0]!.plans[1]!.name = 'vs Rain v2';
  const added = newTeam('Gamma', ''); stored.teams.push(added);
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha (renamed elsewhere)', 'Beta', 'Gamma']);
  assert.equal(r.library.teams[0]!.plans[1]!.name, 'vs Rain v2');
  assert.equal(r.changed, true, 'something came from storage');
  assert.equal(r.unsaved, false, 'storage already holds the result');
});

test('local wins for records edited here since the last save, and the result still needs saving', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams[0]!.name = 'Alpha (mine)';
  stored.teams[0]!.name = 'Alpha (theirs)';
  stored.teams[1]!.name = 'Beta (theirs)';
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha (mine)', 'Beta (theirs)'], 'last writer wins per record, not per library');
  assert.equal(r.changed, true);
  assert.equal(r.unsaved, true);
});

test('edits to different records in two tabs both survive', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams[0]!.plans[0]!.name = 'vs Sun (mine)';
  local.teams[0]!.plans[0]!.tabs[0]!.name = 'Lead A';
  stored.teams[0]!.plans[1]!.opponent.name = 'Their opponent';
  const r = reconcileLibrary(base, local, stored);
  assert.equal(r.library.teams[0]!.plans[0]!.name, 'vs Sun (mine)');
  assert.equal(r.library.teams[0]!.plans[0]!.tabs[0]!.name, 'Lead A');
  assert.equal(r.library.teams[0]!.plans[1]!.opponent.name, 'Their opponent');
});

test('teams and gameplans added in either tab are all kept', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams.push(newTeam('Mine', ''));
  local.teams[1]!.plans.push(newPlan('my plan'));
  stored.teams.push(newTeam('Theirs', ''));
  stored.teams[1]!.plans.push(newPlan('their plan'));
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha', 'Beta', 'Mine', 'Theirs']);
  assert.deepEqual(r.library.teams[1]!.plans.map((p) => p.name).sort(), ['my plan', 'their plan']);
  assert.equal(r.unsaved, true);
});

test('deleted in storage and untouched here: dropped', () => {
  const { base, local, stored } = twoTabs(sample());
  stored.teams.splice(1, 1);
  stored.teams[0]!.plans.splice(0, 1);
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha']);
  assert.deepEqual(r.library.teams[0]!.plans.map((p) => p.name), ['vs Rain']);
  assert.equal(r.unsaved, false);
});

test('deleted in storage but edited here: kept', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams[1]!.paste = 'Incineroar @ Sitrus Berry';
  local.teams[0]!.plans[0]!.name = 'vs Sun (edited)';
  stored.teams.splice(1, 1);
  stored.teams[0]!.plans.splice(0, 1);
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha', 'Beta']);
  assert.deepEqual(r.library.teams[0]!.plans.map((p) => p.name).sort(), ['vs Rain', 'vs Sun (edited)']);
  assert.equal(r.unsaved, true);
});

test('a team deleted in storage stays while one of its gameplans was edited here', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams[0]!.plans[1]!.name = 'vs Rain (edited)';
  stored.teams.splice(0, 1);
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha', 'Beta']);
  assert.deepEqual(r.library.teams[0]!.plans.map((p) => p.name), ['vs Rain (edited)'], 'only the edited gameplan survives');
});

test('deleted here: gone unless the other tab edited it meanwhile', () => {
  const { base, local, stored } = twoTabs(sample());
  local.teams.splice(1, 1); // Beta deleted here, untouched in storage
  local.teams[0]!.plans.splice(1, 1); // vs Rain deleted here...
  stored.teams[0]!.plans[1]!.name = 'vs Rain (edited elsewhere)'; // ...but edited in the other tab
  const r = reconcileLibrary(base, local, stored);
  assert.deepEqual(names(r.library), ['Alpha']);
  assert.deepEqual(r.library.teams[0]!.plans.map((p) => p.name), ['vs Sun', 'vs Rain (edited elsewhere)']);
});

test('order: a reorder made here wins, otherwise the stored order', () => {
  const saved = sample(); saved.teams.push(newTeam('Gamma', ''));
  const one = twoTabs(saved);
  one.stored.teams.reverse();
  assert.deepEqual(names(reconcileLibrary(one.base, one.local, one.stored).library), ['Gamma', 'Beta', 'Alpha']);
  const two = twoTabs(saved);
  two.local.teams.push(two.local.teams.shift()!);
  two.stored.teams.reverse();
  assert.deepEqual(names(reconcileLibrary(two.base, two.local, two.stored).library), ['Beta', 'Gamma', 'Alpha']);
});

test('this tab keeps its own objects, with stored contents copied in', () => {
  const { base, local, stored } = twoTabs(sample());
  const team = local.teams[0]!;
  const plan = team.plans[1]!;
  stored.teams[0]!.name = 'Alpha v2';
  stored.teams[0]!.plans[1]!.name = 'vs Rain v2';
  const r = reconcileLibrary(base, local, stored);
  assert.equal(r.library, local);
  assert.equal(r.library.teams[0], team, 'an open dialog holding the team still edits the library');
  assert.equal(team.name, 'Alpha v2');
  assert.equal(r.library.teams[0]!.plans[1], plan);
  assert.equal(plan.name, 'vs Rain v2');
});
