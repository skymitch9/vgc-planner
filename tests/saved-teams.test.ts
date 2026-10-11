import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTeam } from '../src/domain/model.ts';
import { opponentNameAfterPick, savedTeamChoices } from '../src/domain/saved-teams.ts';

const PASTE = 'Rillaboom @ Assault Vest\nAbility: Grassy Surge\n- Fake Out\n\nIncineroar\n- Flare Blitz\n';

test('savedTeamChoices lists every team in order and flags the current one as a mirror match', () => {
  const rain = newTeam('Rain', PASTE);
  const sun = newTeam('Sun', PASTE);
  const choices = savedTeamChoices({ teams: [rain, sun] }, sun.id);
  assert.deepEqual(choices, [
    { id: rain.id, label: 'Rain', disabled: false },
    { id: sun.id, label: 'Sun (this team — mirror match)', disabled: false },
  ]);
  assert.deepEqual(savedTeamChoices({ teams: [rain, sun] }).map((c) => c.label), ['Rain', 'Sun']);
});

test('a team without Pokémon is listed but cannot be picked; an empty library gives nothing', () => {
  const empty = newTeam('Draft', '');
  assert.deepEqual(savedTeamChoices({ teams: [empty] }, empty.id), [{ id: empty.id, label: 'Draft (no Pokémon yet)', disabled: true }]);
  assert.deepEqual(savedTeamChoices({ teams: [] }), []);
});

test('opponentNameAfterPick fills an empty name, follows its own earlier pick, and keeps a typed name', () => {
  assert.equal(opponentNameAfterPick('', 'Rain', undefined), 'Rain');
  assert.equal(opponentNameAfterPick('   ', 'Rain', undefined), 'Rain');
  assert.equal(opponentNameAfterPick('Rain', 'Sun', 'Rain'), 'Sun');
  assert.equal(opponentNameAfterPick('Finals opponent', 'Sun', 'Rain'), 'Finals opponent');
  assert.equal(opponentNameAfterPick('Finals opponent', 'Sun', undefined), 'Finals opponent');
});
