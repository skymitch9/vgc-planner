import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Dex, setProblems, teamProblems, type DexData, type UsageData } from '../src/domain/dex.ts';
import { buildTopTeams, topTeamSets } from '../src/domain/top-teams.ts';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const data = read<DexData>('champions-mc.json');
const usage = read<UsageData>('usage-mc.json');
const dex = new Dex(data, usage);
const teams = buildTopTeams(dex);

test('builds at least ten six-Pokémon teams, most used member first', () => {
  assert.ok(teams.length >= 10, `only ${teams.length} teams`);
  assert.ok(teams.length <= 25);
  for (const t of teams) {
    assert.equal(t.members.length, 6);
    for (let i = 1; i < 6; i++) assert.ok(t.members[i - 1]!.usage >= t.members[i]!.usage);
    assert.equal(t.name, `${t.members[0]!.name} / ${t.members[1]!.name}`);
    assert.ok(t.score > 0);
  }
  for (let i = 1; i < teams.length; i++) assert.ok(teams[i - 1]!.score >= teams[i]!.score);
});

test('every team is legal: no set problems, no Species or Item Clause clashes', () => {
  for (const t of teams) {
    const sets = topTeamSets(t, dex);
    assert.deepEqual(teamProblems(sets, dex), [], t.name);
    assert.deepEqual(sets.flatMap((s) => setProblems(s, dex)), [], t.name);
  }
});

test('no two teams share five or more members', () => {
  for (let i = 0; i < teams.length; i++) {
    const names = new Set(teams[i]!.members.map((m) => m.name));
    for (let j = i + 1; j < teams.length; j++) {
      const shared = teams[j]!.members.filter((m) => names.has(m.name)).length;
      assert.ok(shared < 5, `${teams[i]!.name} and ${teams[j]!.name} share ${shared}`);
    }
  }
});

test('the most used Pokémon is on the first team', () => {
  const top = [...usage.mons].sort((a, b) => b.usage - a.usage)[0]!;
  assert.ok(teams[0]!.members.some((m) => m.name === top.name), `${top.name} not in ${teams[0]!.members.map((m) => m.name).join(', ')}`);
});

test('the result is deterministic, with stable IDs', () => {
  const again = buildTopTeams(new Dex(data, usage));
  assert.deepEqual(again.map((t) => [t.id, t.name, t.score, t.members.map((m) => m.name)]), teams.map((t) => [t.id, t.name, t.score, t.members.map((m) => m.name)]));
  assert.equal(new Set(teams.map((t) => t.id)).size, teams.length);
});

test('count limits the result, and no usage data means no teams', () => {
  assert.equal(buildTopTeams(dex, 3).length, 3);
  assert.deepEqual(buildTopTeams(new Dex(data)), []);
});

test('choosing another spread changes only that member’s nature and Stat Points', () => {
  const team = teams[0]!;
  const index = team.members.findIndex((m) => m.spreads.length >= 2);
  assert.ok(index >= 0, 'no member with two spreads');
  const mon = team.members[index]!;
  const before = topTeamSets(team, dex);
  const after = topTeamSets(team, dex, { [mon.name]: 1 });
  for (let i = 0; i < 6; i++) {
    if (i !== index) { assert.deepEqual(after[i], before[i]); continue; }
    const a = after[i]!; const b = before[i]!;
    assert.ok(a.evs !== b.evs || a.nature !== b.nature, 'spread did not change');
    assert.deepEqual({ ...a, evs: '', nature: '' }, { ...b, evs: '', nature: '' });
  }
});
