import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BULK_MAX_ITEMS, capBulk, looksLikeBackup, nameFor, splitBulk, teamKey, type BulkItem, type BulkPaste } from '../src/domain/bulk-import.ts';
import { EXPORT_FORMAT, LIMITS, buildExport } from '../src/domain/codec.ts';
import { newTeam } from '../src/domain/model.ts';
import { parseShowdown } from '../src/domain/showdown.ts';

const SPECIES = ['Rillaboom', 'Incineroar', 'Garchomp', 'Kingambit', 'Pelipper', 'Archaludon', 'Sneasler', 'Tyranitar', 'Excadrill', 'Dragonite', 'Gholdengo', 'Whimsicott', 'Torkoal'];
const mon = (species: string): string => `${species} @ Sitrus Berry\nAbility: Pressure\n- Protect\n- Tackle`;
const team = (from: number, count: number): string => SPECIES.slice(from, from + count).map(mon).join('\n\n');
const pastes = (items: BulkItem[]): BulkPaste[] => items.filter((i): i is BulkPaste => i.kind === 'paste');
const species = (item: BulkPaste): string[] => parseShowdown(item.paste).map((m) => m.species);

test('a paste link on its own line is its own item, wherever it appears', () => {
  const items = splitBulk(`${team(0, 2)}\nhttps://pokepast.es/d8dd7d70dff01410\n${team(2, 2)}\n\n  vrpastes.com/abcd1234  \n`);
  assert.deepEqual(items.map((i) => i.kind), ['paste', 'link', 'paste', 'link']);
  assert.deepEqual(items[1], { kind: 'link', url: 'https://pokepast.es/d8dd7d70dff01410', site: 'pokepaste' });
  assert.deepEqual(items[3], { kind: 'link', url: 'vrpastes.com/abcd1234', site: 'vrpastes' });
  assert.deepEqual(species(items[0] as BulkPaste), ['Rillaboom', 'Incineroar']);
  assert.deepEqual(species(items[2] as BulkPaste), ['Garchomp', 'Kingambit']);
});

test('a link inside a sentence is not a link item', () => {
  assert.deepEqual(splitBulk('see https://pokepast.es/d8dd7d70dff01410 for the team').map((i) => i.kind), ['paste']);
});

test('teambuilder headers start a team and name it, without the format tag or the folder', () => {
  const items = pastes(splitBulk(`=== [gen9championsvgc2026regmc] My Rain ===\n\n${team(0, 6)}\n\n=== [gen9vgc2026] Worlds/Sun balance ===\n\n${team(6, 4)}\n\n=== Untagged ===\n${team(10, 1)}`));
  assert.deepEqual(items.map((i) => i.name), ['My Rain', 'Sun balance', 'Untagged']);
  assert.deepEqual(items.map((i) => species(i).length), [6, 4, 1]);
  assert.ok(items.every((i) => !i.partial));
  assert.ok(items.every((i) => !i.paste.includes('===')));
});

test('a header with no name starts an unnamed team; a header with no Pokémon gives nothing', () => {
  const items = pastes(splitBulk(`${team(0, 2)}\n=== [gen9vgc2026] ===\n${team(2, 2)}\n=== [gen9vgc2026] Empty ===\n`));
  assert.equal(items.length, 2);
  assert.equal(items[1]!.name, undefined);
});

test('a line of dashes or equals signs separates teams', () => {
  const items = pastes(splitBulk(`${team(0, 3)}\n---\n${team(3, 3)}\n\n=====\n\n${team(6, 2)}\n----------\n\n---\n`));
  assert.deepEqual(items.map(species), [SPECIES.slice(0, 3), SPECIES.slice(3, 6), SPECIES.slice(6, 8)]);
  // Two dashes, or a dash followed by a move, are not separators.
  assert.equal(pastes(splitBulk(`${mon('Rillaboom')}\n- Fake Out\n--\n\n${mon('Garchomp')}`)).length, 1);
});

test('blank lines between Pokémon of one team never split it', () => {
  const items = splitBulk(SPECIES.slice(0, 6).map(mon).join('\n\n\n\n'));
  assert.equal(items.length, 1);
  assert.equal(species(items[0] as BulkPaste).length, 6);
});

test('more than six Pokémon in a row are cut into teams of six; the rest is a partial team', () => {
  const items = pastes(splitBulk(team(0, 13)));
  assert.deepEqual(items.map((i) => species(i).length), [6, 6, 1]);
  assert.deepEqual(items.map((i) => i.partial), [undefined, undefined, true]);
  assert.deepEqual(species(items[1]!), SPECIES.slice(6, 12));
  assert.deepEqual(species(items[2]!), ['Torkoal']);
  // Exactly twelve: two full teams, nothing partial. A short team on its own isn't "partial" either.
  assert.deepEqual(pastes(splitBulk(team(0, 12))).map((i) => i.partial), [undefined, undefined]);
  assert.equal(pastes(splitBulk(team(0, 4)))[0]!.partial, undefined);
});

test('a header’s name goes to every team cut from its run', () => {
  assert.deepEqual(pastes(splitBulk(`=== Box ===\n${team(0, 8)}`)).map((i) => [i.name, i.partial]), [['Box', undefined], ['Box', true]]);
});

test('mixed input keeps its order: links, headers and raw teams', () => {
  const text = [team(0, 2), '---', team(2, 2), '=== [gen9championsvgc2026regmc] My Rain ===', team(4, 6), 'https://pokepast.es/d8dd7d70dff01410', team(10, 2), 'vrpastes.com/abcd1234'].join('\n\n');
  const items = splitBulk(text);
  assert.deepEqual(items.map((i) => (i.kind === 'link' ? i.url : i.name ?? species(i).join('+'))), [
    'Rillaboom+Incineroar', 'Garchomp+Kingambit', 'My Rain', 'https://pokepast.es/d8dd7d70dff01410', 'Gholdengo+Whimsicott', 'vrpastes.com/abcd1234',
  ]);
});

test('CRLF line endings read the same as LF', () => {
  const text = `=== [gen9vgc2026] Folder/Rain ===\n\n${team(0, 6)}\n---\n${team(6, 3)}\nhttps://pokepast.es/d8dd7d70dff01410\n`;
  assert.deepEqual(splitBulk(text.replace(/\n/g, '\r\n')), splitBulk(text));
  assert.equal(splitBulk(text).length, 3);
  assert.ok(!pastes(splitBulk(text.replace(/\n/g, '\r\n')))[0]!.paste.includes('\r'));
});

test('nicknames and genders in the head line survive', () => {
  const [item] = pastes(splitBulk('Rocky (Kommo-o) (F) @ Clear Amulet\nAbility: Soundproof\n- Clanging Scales\n\nGarchomp (M)\n- Earthquake\n\nBig Guy (Snorlax)\n- Body Slam'));
  const sets = parseShowdown(item!.paste);
  assert.deepEqual(sets.map((s) => [s.nickname, s.species, s.gender]), [['Rocky', 'Kommo-o', 'F'], ['', 'Garchomp', 'M'], ['Big Guy', 'Snorlax', '']]);
});

test('empty input and separators alone give nothing', () => {
  assert.deepEqual(splitBulk(''), []);
  assert.deepEqual(splitBulk(null), []);
  assert.deepEqual(splitBulk('\n\n---\n   \n=====\n'), []);
});

test('capBulk keeps 50 items at most and no more than the library has room for', () => {
  const items = splitBulk(Array.from({ length: 60 }, (_, i) => mon(SPECIES[i % SPECIES.length]!)).join('\n---\n'));
  assert.equal(items.length, 60);
  assert.deepEqual(capBulk(items, 0), { items: items.slice(0, BULK_MAX_ITEMS), dropped: 10, reason: 'batch' });
  assert.deepEqual(capBulk(items, LIMITS.teams - 3), { items: items.slice(0, 3), dropped: 57, reason: 'library' });
  assert.deepEqual(capBulk(items, LIMITS.teams + 5), { items: [], dropped: 60, reason: 'library' });
  assert.deepEqual(capBulk(items.slice(0, 4), 10), { items: items.slice(0, 4), dropped: 0, reason: null });
});

test('nameFor: the hint, else the first two Pokémon, numbered when taken', () => {
  const sets = parseShowdown(team(0, 6));
  assert.equal(nameFor(sets, ' My Rain '), 'My Rain');
  assert.equal(nameFor(sets), 'Rillaboom / Incineroar');
  assert.equal(nameFor(sets.slice(0, 1)), 'Rillaboom');
  assert.equal(nameFor([]), 'Team');
  assert.equal(nameFor(sets, '', ['Rillaboom / Incineroar']), 'Rillaboom / Incineroar (2)');
  assert.equal(nameFor(sets, 'Rain', ['rain', 'Rain (2)', 'Other']), 'Rain (3)');
  assert.ok(nameFor(sets, 'x'.repeat(1000)).length <= LIMITS.nameLength);
});

test('teamKey ignores spacing and line endings, not content', () => {
  const a = parseShowdown(team(0, 6));
  assert.equal(teamKey(a), teamKey(parseShowdown(team(0, 6).replace(/\n\n/g, '\r\n\r\n\r\n'))));
  assert.notEqual(teamKey(a), teamKey(parseShowdown(team(1, 6))));
});

test('looksLikeBackup tells this app’s export file from team pastes', () => {
  const library = { teams: [newTeam('Rain', team(0, 6))] };
  assert.equal(looksLikeBackup(JSON.stringify(buildExport(library, { type: 'all' }), null, 2)), true);
  assert.equal(looksLikeBackup(`  {"format":"${EXPORT_FORMAT}","teams":[]}  `), true);
  assert.equal(looksLikeBackup('{"format":"something-else","teams":[]}'), false);
  assert.equal(looksLikeBackup(`{"format":"${EXPORT_FORMAT}"`), false); // cut-off JSON
  assert.equal(looksLikeBackup(team(0, 6)), false);
  assert.equal(looksLikeBackup('https://pokepast.es/d8dd7d70dff01410'), false);
  assert.equal(looksLikeBackup(''), false);
  assert.equal(looksLikeBackup('[1,2]'), false);
});
