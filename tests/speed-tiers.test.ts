import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Dex, type DexData, type UsageData } from '../src/domain/dex.ts';
import { parseShowdown } from '../src/domain/showdown.ts';
import { NO_TOGGLES, applyStage, matchup, speedTiers, teamEntries, type SpeedEntry } from '../src/domain/speed-tiers.ts';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dex = new Dex(read<DexData>('champions-mc.json'), read<UsageData>('usage-mc.json'));

const mine = (key: string, speed: number): SpeedEntry => ({ key, speed, name: key, spread: '', mine: true });
const foe = (key: string, speed: number, scarf = false): SpeedEntry => ({ key, speed, name: key, spread: '', mine: false, scarf });

test('stages round down like the games: +1 is x3/2, -1 is x2/3', () => {
  assert.equal(applyStage(101, 1), 151);
  assert.equal(applyStage(101, -1), 67);
  assert.equal(applyStage(100, 0), 100);
});

test('fastest first, ties are marked, Trick Room reverses the order', () => {
  const list = [foe('a', 100), mine('me', 120), foe('b', 120), foe('c', 80)];
  const rows = speedTiers(list, NO_TOGGLES);
  assert.deepEqual(rows.map((r) => r.key), ['me', 'b', 'a', 'c']);
  assert.deepEqual(rows.map((r) => r.tie), [true, true, false, false]);
  const tr = speedTiers(list, { ...NO_TOGGLES, trickRoom: true });
  assert.deepEqual(tr.map((r) => r.key), ['c', 'a', 'me', 'b']);
});

test('Tailwind and stages apply to my team only; Scarf only to Scarf threats', () => {
  const list = [mine('me', 101), foe('fast', 150), foe('scarfer', 100, true)];
  const tw = speedTiers(list, { ...NO_TOGGLES, tailwind: true });
  assert.deepEqual(tw.map((r) => [r.key, r.effective]), [['me', 202], ['fast', 150], ['scarfer', 100]]);
  const up = speedTiers(list, { ...NO_TOGGLES, stage: 1 });
  assert.equal(up.find((r) => r.key === 'me')?.effective, 151);
  const down = speedTiers(list, { ...NO_TOGGLES, stage: -1, tailwind: true });
  assert.equal(down.find((r) => r.key === 'me')?.effective, 134);
  const scarf = speedTiers(list, { ...NO_TOGGLES, scarf: true });
  assert.equal(scarf.find((r) => r.key === 'scarfer')?.effective, 150);
  assert.equal(scarf.find((r) => r.key === 'fast')?.effective, 150);
});

test('matchup counts threats outspeed, tied and slower, Trick Room aware', () => {
  const list = [mine('me', 100), mine('mate', 50), foe('a', 120), foe('b', 100), foe('c', 80), foe('d', 60)];
  const rows = speedTiers(list, NO_TOGGLES);
  assert.deepEqual(matchup(rows, 'me', NO_TOGGLES), { outspeeds: 2, ties: 1, slower: 1 });
  const tr = { ...NO_TOGGLES, trickRoom: true };
  assert.deepEqual(matchup(speedTiers(list, tr), 'me', tr), { outspeeds: 1, ties: 1, slower: 2 });
});

test('team entries use the paste spread (Jolly 18 Spe Sneasler 173 beats Adamant 32 Spe 172), plus the Mega form', () => {
  const team = parseShowdown(`Garchomp @ Garchompite Z
Ability: Rough Skin
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Protect

Sneasler @ White Herb
Ability: Unburden
EVs: 32 Atk / 18 Spe
jolly Nature
- Protect

Sneasler @ Focus Sash
Ability: Unburden
EVs: 32 Atk / 32 Spe
Adamant Nature
- Protect
`);
  const rows = teamEntries(team, dex);
  const garchomp = dex.species('Garchomp')!;
  const mega = dex.megaFor(garchomp, 'Garchompite Z')!;
  const speed = (base: number): number => Math.floor(((base + 32 + 20) * 11) / 10);
  assert.deepEqual(rows.map((r) => [r.name, r.speed, r.mine]), [
    ['Garchomp', speed(garchomp.baseStats.spe), true],
    [mega.name, speed(mega.baseStats.spe), true],
    ['Sneasler', 173, true],
    ['Sneasler', 172, true],
  ]);
  assert.equal(rows[2]!.spread, 'Jolly · 18 Spe');
});
