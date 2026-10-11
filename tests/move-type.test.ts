import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Dex, type DexData, type UsageData } from '../src/domain/dex.ts';
import { MOVE_TYPES, moveLabel, moveType, moveTypeChip, typeChip, typeClass, type TypeLookup } from '../src/ui/move-type.ts';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dex = new Dex(read<DexData>('champions-mc.json'), read<UsageData>('usage-mc.json'));
const lookup: TypeLookup = (move) => dex.move(move)?.type;
const css = readFileSync(new URL('../src/styles/builder.css', import.meta.url), 'utf8');

test('a known move gets its type class and a title naming the type', () => {
  assert.equal(moveLabel('Flare Blitz', { lookup }), '<span class="mvl t-fire" title="Fire">Flare Blitz</span>');
  assert.equal(moveLabel('Fake Out', { lookup }), '<span class="mvl t-normal" title="Normal">Fake Out</span>');
  // Names are matched the way the data matches them: case and punctuation don't matter.
  assert.equal(moveLabel('u-turn', { lookup }), '<span class="mvl t-bug" title="Bug">u-turn</span>');
});

test('an unknown move, an empty name, or no data yet comes back as plain escaped text', () => {
  assert.equal(moveLabel('Not A Move', { lookup }), 'Not A Move');
  assert.equal(moveLabel('', { lookup }), '');
  assert.equal(moveLabel('Intimidate', { lookup }), 'Intimidate');
  // The default lookup reads the lazily loaded data, which no test has loaded.
  assert.equal(moveLabel('Flare Blitz'), 'Flare Blitz');
  assert.equal(moveType('Flare Blitz'), null);
  assert.equal(moveTypeChip('Flare Blitz'), '');
  // A source that answers with something that isn't a type is ignored.
  assert.equal(moveLabel('Flare Blitz', { lookup: () => 'Plasma' }), 'Flare Blitz');
  assert.equal(moveLabel('Flare Blitz', { type: null }), 'Flare Blitz');
  assert.equal(moveLabel('Flare Blitz', { type: '' }), 'Flare Blitz');
});

test('hostile text is escaped, with or without a type', () => {
  const evil = '<img src=x onerror="alert(1)">';
  const safe = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
  assert.equal(moveLabel(evil, { lookup }), safe);
  assert.equal(moveLabel(evil, { type: 'Fire' }), `<span class="mvl t-fire" title="Fire">${safe}</span>`);
  assert.equal(moveLabel('Protect', { lookup, text: `${evil}'s Protect` }), `<span class="mvl t-normal" title="Normal">${safe}&#39;s Protect</span>`);
  // A type that isn't one never reaches the class or the title.
  assert.equal(moveLabel('X', { type: 'fire" onmouseover="x' }), 'X');
  assert.equal(typeClass('fire" onmouseover="x'), 't-none');
  assert.equal(typeChip('<b>'), '<span class="type t-none">&lt;b&gt;</span>');
});

test('a type given by the caller skips the lookup; the shown text can differ from the name', () => {
  assert.equal(moveLabel('Whatever', { type: 'water' }), '<span class="mvl t-water" title="Water">Whatever</span>');
  assert.equal(moveLabel('Protect', { lookup, text: 'Incineroar’s Protect' }), '<span class="mvl t-normal" title="Normal">Incineroar’s Protect</span>');
});

test('all 18 types map to a class that the stylesheet colours, once each', () => {
  assert.equal(MOVE_TYPES.length, 18);
  assert.equal(new Set(MOVE_TYPES).size, 18);
  for (const type of MOVE_TYPES) {
    const cls = `t-${type.toLowerCase()}`;
    assert.equal(typeClass(type), cls);
    assert.equal(typeClass(type.toUpperCase()), cls);
    assert.equal(moveLabel('M', { type }), `<span class="mvl ${cls}" title="${type}">M</span>`);
    assert.equal(typeChip(type), `<span class="type ${cls}">${type}</span>`);
    // One colour per type: the class sets --type, and nothing else in the stylesheet repeats it.
    assert.equal(css.split(`.${cls} {`).length - 1, 1, `${cls} is defined once`);
    assert.match(css, new RegExp(`\\.${cls} \\{ --type: #[0-9a-f]{6}; \\}`));
  }
});

test('every move in the Reg M-C data has one of the 18 types', () => {
  const data = read<DexData>('champions-mc.json');
  const seen = new Set<string>();
  for (const move of Object.values(data.moves)) {
    assert.ok((MOVE_TYPES as readonly string[]).includes(move.type), `${move.name}: ${move.type}`);
    assert.equal(moveType(move.name, lookup), move.type);
    seen.add(move.type);
  }
  assert.equal(seen.size, 18);
});

test('the chip beside a move box shows the chosen move’s type', () => {
  assert.equal(moveTypeChip('Draco Meteor', lookup), '<span class="type t-dragon">Dragon</span>');
  assert.equal(moveTypeChip('', lookup), '');
  assert.equal(moveTypeChip('Not A Move', lookup), '');
});
