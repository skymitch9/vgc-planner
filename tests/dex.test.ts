import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Dex, setFromUsage, setProblems, teamProblems, writeTeam, type DexData, type UsageData } from '../src/domain/dex.ts';
import { parseShowdown } from '../src/domain/showdown.ts';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dex = new Dex(read<DexData>('champions-mc.json'), read<UsageData>('usage-mc.json'));

const LEGAL = `Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 14 Def / 20 SpD
Careful Nature
- Fake Out
- Parting Shot
- Flare Blitz
- Throat Chop

Garchomp @ Garchompite Z
Ability: Rough Skin
Tera Type: Fire
EVs: 2 HP / 32 SpA / 32 Spe
Modest Nature
- Draco Meteor
- Earth Power
- Flamethrower
- Protect
`;

test('a legal team has no problems, and survives a parse/write round trip', () => {
  const sets = parseShowdown(LEGAL);
  assert.deepEqual(sets.flatMap((s) => setProblems(s, dex)), []);
  assert.deepEqual(teamProblems(sets, dex), []);
  const again = parseShowdown(writeTeam(sets));
  assert.deepEqual(again, sets);
  assert.match(writeTeam(sets), /Tera Type: Fire/);
});

test('moves a species cannot learn are flagged', () => {
  const [mon] = parseShowdown('Incineroar @ Sitrus Berry\nAbility: Intimidate\n- Moonblast\n- Spore\n- Fake Out\n- Fake Out');
  const problems = setProblems(mon!, dex);
  assert.ok(problems.some((p) => /can't learn Moonblast/.test(p)), problems.join('\n'));
  // Nothing in Champions learns Spore, so it isn't a move of the format at all.
  assert.ok(problems.some((p) => /Spore isn't an allowed move/.test(p)));
  assert.ok(problems.some((p) => /listed twice/.test(p)));
});

test('banned or missing species, wrong abilities and items are flagged', () => {
  const [mewtwo, amoonguss, chomp] = parseShowdown('Mewtwo\n- Psychic\n\nAmoonguss\n- Spore\n\nGarchomp @ Gengarite\nAbility: Intimidate\n- Protect');
  assert.match(setProblems(mewtwo!, dex)[0]!, /isn't allowed/);
  assert.match(setProblems(amoonguss!, dex)[0]!, /isn't allowed/);
  const p = setProblems(chomp!, dex);
  assert.ok(p.some((x) => /Gengarite only works on its own/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /can't have Intimidate/.test(x)));
});

test('Stat Points: EVs are converted first, then the total is checked', () => {
  const [ok] = parseShowdown('Incineroar\nEVs: 252 HP / 252 Atk / 4 Def\n- Fake Out');
  assert.ok(!setProblems(ok!, dex).some((x) => /Stat Points/.test(x)));
  const [over] = parseShowdown('Incineroar\nEVs: 252 HP / 252 Atk / 252 Def\n- Fake Out');
  assert.ok(setProblems(over!, dex).some((x) => /96 Stat Points \(from EVs\)/.test(x)));
});

test('Species Clause and Item Clause', () => {
  const sets = parseShowdown('Raichu @ Sitrus Berry\n- Protect\n\nRaichu-Alola @ Sitrus Berry\n- Protect\n\nRaichu @ Life Orb\n- Protect');
  const p = teamProblems(sets, dex);
  assert.ok(p.some((x) => /Species Clause/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /Item Clause: Sitrus Berry/.test(x)));
});

test('a pasted Mega name is accepted with its stone', () => {
  const [mon] = parseShowdown('Salamence-Mega @ Salamencite\nAbility: Aerilate\n- Hyper Voice\n- Protect');
  assert.deepEqual(setProblems(mon!, dex), []);
});

test('legal items include a species’ own Mega Stones and no one else’s', () => {
  const chomp = dex.species('Garchomp')!;
  const names = dex.legalItems(chomp).map((i) => i.name);
  assert.ok(names.includes('Garchompite') && names.includes('Garchompite Z') && names.includes('Sitrus Berry'));
  assert.ok(!names.includes('Gengarite'));
});

test('every top build from usage is legal, Megas written as base species with the stone', () => {
  assert.ok(dex.usage && dex.usage.mons.length > 100);
  for (const mon of dex.usage!.mons) {
    const set = setFromUsage(mon, dex);
    assert.deepEqual(setProblems(set, dex), [], `${mon.name}: ${JSON.stringify(set)}`);
    assert.ok(set.moves.length === 4, `${mon.name} has ${set.moves.length} moves`);
  }
  const sala = setFromUsage(dex.usage!.mons.find((m) => m.name === 'Salamence-Mega')!, dex);
  assert.equal(sala.species, 'Salamence');
  assert.equal(sala.item, 'Salamencite');
  assert.ok(dex.species('Salamence')!.abilities.includes(sala.ability));
});

test('usage lookups and ordering', () => {
  const chomp = dex.species('Garchomp-Mega-Z')!;
  assert.equal(chomp.name, 'Garchomp');
  assert.deepEqual(dex.usageFor(chomp).map((u) => u.name).sort(), ['Garchomp', 'Garchomp-Mega', 'Garchomp-Mega-Z'].filter((n) => dex.usage!.mons.some((m) => m.name === n)).sort());
  assert.equal(dex.speciesByUsage()[0]!.name, dex.usage!.mons[0]!.species);
  assert.ok((dex.moveUsage(dex.species('Rillaboom')!).get('fakeout') ?? 0) > 90);
});
