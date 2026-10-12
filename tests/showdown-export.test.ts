import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showdownPaste, writeSet } from '../src/domain/dex.ts';
import { parseShowdown } from '../src/domain/showdown.ts';
import { fileName } from '../src/domain/strings.ts';
import { ALICE, BOB } from './fixtures/replays/champions-1-teams.ts';

/** A team with the awkward cases: nickname + gender, no item, fewer than four moves, Tera/Shiny lines, IVs. */
const ODD = `Rocky (Kommo-o) (F) @ Clear Amulet
Ability: Soundproof
Tera Type: Fire
- Clanging Scales

Floette-Mega
- Moonblast

Incineroar
Ability: Intimidate
Level: 50
Shiny: Yes
EVs: 32 HP / 14 Def / 20 SpD
Careful Nature
IVs: 0 Atk
- Fake Out
- Parting Shot
`;

test('the Showdown export round-trips through the parser for every fixture team', () => {
  for (const [name, paste] of Object.entries({ ALICE, BOB, ODD })) {
    const sets = parseShowdown(paste);
    const exported = showdownPaste(paste);
    assert.deepEqual(parseShowdown(exported), sets, name);
    // Writing it twice changes nothing: the export is already in its final form.
    assert.equal(showdownPaste(exported), exported, name);
  }
  assert.equal(parseShowdown(showdownPaste(ALICE)).length, 6);
});

test('empty slots, format headers and stray blank lines are dropped; sets are one blank line apart', () => {
  const messy = `=== [gen9championsvgc2026regmc] Folder/Team ===\n\n\n${ALICE.split('\n\n').slice(0, 2).join('\n\n\n\n')}\n\n   \n\n`;
  const out = showdownPaste(messy);
  assert.equal(out.split('\n\n').length, 2);
  assert.doesNotMatch(out, /===/);
  assert.doesNotMatch(out, /\n\n\n/);
  assert.ok(out.endsWith('- Protect\n'));
  assert.equal(showdownPaste(''), '');
  assert.equal(showdownPaste('\n\n  \n'), '');
});

test('each set is written in standard Showdown order', () => {
  const [kommo, floette, incin] = parseShowdown(ODD);
  assert.equal(writeSet(kommo!), 'Rocky (Kommo-o) (F) @ Clear Amulet\nAbility: Soundproof\nTera Type: Fire\n- Clanging Scales');
  assert.equal(writeSet(floette!), 'Floette-Mega\n- Moonblast');
  assert.equal(writeSet(incin!), 'Incineroar\nAbility: Intimidate\nLevel: 50\nShiny: Yes\nEVs: 32 HP / 14 Def / 20 SpD\nCareful Nature\nIVs: 0 Atk\n- Fake Out\n- Parting Shot');
  // The Stat Point line is kept exactly as the app imports it (Champions points, zero stats left out).
  assert.match(showdownPaste(ALICE), /^EVs: 32 HP \/ 32 Atk \/ 2 Spe$/m);
});

test('a nickname equal to the species is not written twice', () => {
  const [mon] = parseShowdown('Garchomp (Garchomp) @ Life Orb\n- Earthquake');
  assert.equal(writeSet(mon!).split('\n')[0], 'Garchomp @ Life Orb');
});

test('file names keep the team name but drop characters file systems refuse', () => {
  assert.equal(fileName('Sun Team'), 'Sun Team');
  assert.equal(fileName('Rain: v2 / "final"?'), 'Rain v2 final');
  assert.equal(fileName('  ..hidden.  '), 'hidden');
  assert.equal(fileName('<>:"/\\|?*'), 'team');
  assert.equal(fileName(''), 'team');
  assert.equal(fileName('x'.repeat(300)).length, 100);
});
