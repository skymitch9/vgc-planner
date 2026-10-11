import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DataError } from '../src/domain/codec.ts';
import { Dex, type DexData, type UsageData } from '../src/domain/dex.ts';
import { parseShowdown } from '../src/domain/showdown.ts';
import { FEED_LIMITS, fillSpreads, placingLabel, readFeed, resolvePaste } from '../src/domain/team-feed.ts';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dex = new Dex(read<DexData>('champions-mc.json'), read<UsageData>('usage-mc.json'));
const fixture = (): unknown => JSON.parse(readFileSync(new URL('./fixtures/team-feed.json', import.meta.url), 'utf8'));

/** A real published feed (vgc-meta's output) when it sits next to this repo; the saved fixture is always tested too. */
function liveFeedPath(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'vgc-meta', 'public', 'feed.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

test('reads the saved feed fixture: entries, sources, optional fields', () => {
  const feed = readFeed(fixture());
  assert.equal(feed.entries.length, 5);
  assert.equal(feed.skipped, 0);
  assert.match(feed.format, /Reg M-C/);
  assert.ok(feed.generated);
  assert.ok(feed.sources.length >= 3 && feed.sources.every((s) => s.teams >= 0 && s.label));
  const eric = feed.entries.find((e) => e.id === 'limitless-7038')!;
  assert.equal(eric.spreads, 'confirmed');
  assert.deepEqual(eric.replicaCodes, ['9NNN3', 'N8A4G']);
  assert.equal(eric.placing, 1);
  assert.equal(eric.paste, 'pastes/limitless-7038.txt');
  assert.match(eric.spreadUrl ?? '', /^https:\/\/www\.youtube\.com\//);
  const speciesOnly = feed.entries.find((e) => e.id === 'victoryroad-0RSMBR6WR8')!;
  assert.equal(speciesOnly.paste, null);
  const creator = feed.entries.find((e) => e.tier === 'creator')!;
  assert.equal(creator.placing, null);
});

test('reads the live published feed when it is present next to the repo', (t) => {
  const path = liveFeedPath();
  if (!path) { t.skip('no ../vgc-meta/public/feed.json here'); return; }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: unknown[] };
  const feed = readFeed(raw);
  assert.equal(feed.skipped, 0, 'every entry of the real feed is valid');
  assert.equal(feed.entries.length, raw.entries.length);
  assert.ok(feed.entries.length >= 100);
});

test('rejects things that are not a feed, and feeds that are too big', () => {
  for (const bad of [null, 42, 'feed', [], {}, { entries: 'x' }]) assert.throws(() => readFeed(bad), DataError, JSON.stringify(bad));
  const big = { entries: Array.from({ length: FEED_LIMITS.entries + 1 }, (_, i) => ({ id: `t${i}`, tier: 'online' })) };
  assert.throws(() => readFeed(big), /at most 2000/);
  assert.throws(() => readFeed({ entries: [{ nope: 1 }, 7, null] }), /None of the feed's 3 teams/);
});

test('drops bad entries and unknown fields, caps text, and keeps only http(s) links', () => {
  const feed = readFeed({
    format: 'F', generated: 'not a date', sneaky: '<script>',
    entries: [
      { id: 'ok', tier: 'regional', title: 'x'.repeat(5000), player: 'P', event: 'E', date: '2026-10-03', placing: 3, paste: 'pastes/ok.txt', spreads: 'partial', source: 'javascript:alert(1)', spreadUrl: 'data:text/html,hi', replicaCodes: ['ab12c', '<b>', 7, 'ZZZZZ', 'Y', 'W'], extra: { deep: true } },
      { id: 'ok', tier: 'regional' }, // duplicate id
      { id: 'tier', tier: 'galactic' }, // unknown tier
      { id: 'paste', tier: 'online', paste: 12 }, // paste of the wrong type
      { id: 'min', tier: 'online', spreads: 'guessed', placing: -1, date: '3 Oct' },
    ],
  });
  assert.equal(feed.entries.length, 2);
  assert.equal(feed.skipped, 3);
  assert.equal(feed.generated, '');
  assert.ok(!('sneaky' in feed));
  const [ok, min] = feed.entries;
  assert.equal(Array.from(ok!.title).length, FEED_LIMITS.text);
  assert.equal(ok!.source, '');
  assert.equal(ok!.spreadUrl, undefined);
  assert.deepEqual(ok!.replicaCodes, ['AB12C', 'ZZZZZ']);
  assert.ok(!('extra' in ok!));
  assert.equal(min!.spreads, 'estimated');
  assert.equal(min!.placing, null);
  assert.equal(min!.date, '');
  assert.equal(min!.title, 'min');
});

test('resolves relative pastes against the feed URL, and refuses pastes on another site', () => {
  assert.equal(resolvePaste('http://localhost:4400/feed.json', { paste: 'pastes/limitless-7038.txt' }), 'http://localhost:4400/pastes/limitless-7038.txt');
  assert.equal(resolvePaste('https://teams.example/vgc/feed.json', { paste: 'pastes/a.txt' }), 'https://teams.example/vgc/pastes/a.txt');
  assert.equal(resolvePaste('https://teams.example/vgc/feed.json', { paste: '/p/a.txt' }), 'https://teams.example/p/a.txt');
  assert.equal(resolvePaste('https://teams.example/vgc/feed.json', { paste: 'https://teams.example/x.txt' }), 'https://teams.example/x.txt');
  assert.equal(resolvePaste('https://teams.example/feed.json', { paste: null }), null);
  for (const paste of ['https://evil.example/x.txt', '//evil.example/x.txt', 'http://teams.example/x.txt', 'javascript:alert(1)', 'data:text/plain,hi']) {
    assert.throws(() => resolvePaste('https://teams.example/feed.json', { paste }), DataError, paste);
  }
});

test('fillSpreads fills only the sets without a spread, keeping the player nature and Mega form', () => {
  const sets = parseShowdown(`Sylveon @ Fairy Feather
Ability: Pixilate
Level: 50
Modest Nature
- Hyper Voice

Charizard @ Charizardite Y
Ability: Blaze
Level: 50
Timid Nature
- Heat Wave

Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 30 HP / 20 Def / 14 SpD / 2 Spe
Impish Nature
- Fake Out`);
  const before = structuredClone(sets);
  const { sets: filled, estimated } = fillSpreads(sets, dex);
  assert.deepEqual(sets, before, 'the input is not changed');
  assert.deepEqual(estimated, ['Sylveon', 'Charizard']);
  assert.equal(filled[2]!.evs, '30 HP / 20 Def / 14 SpD / 2 Spe');
  assert.equal(filled[2]!.nature, 'Impish');
  for (const s of filled.slice(0, 2)) assert.match(s.evs, /\d+ (HP|Atk|Def|SpA|SpD|Spe)/);
  assert.equal(filled[0]!.nature, 'Modest');
  assert.equal(filled[1]!.nature, 'Timid');
  // The Charizard holding the Y stone gets Charizard-Mega-Y's spread, not Mega X's.
  const megaY = dex.usageFor(dex.species('Charizard')).find((m) => m.mega === 'Charizardite Y')!;
  const expected = megaY.spreads.find(([n]) => n === 'Timid') ?? megaY.spreads[0]!;
  assert.equal(filled[1]!.evs.replace(/\s/g, ''), expected[1].split('/').map((v, i) => (Number(v) ? `${v}${['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'][i]}` : '')).filter(Boolean).join('/'));
});

test('fillSpreads leaves unknown species alone and does not list them', () => {
  const { sets, estimated } = fillSpreads(parseShowdown('Missingno\n- Water Gun'), dex);
  assert.equal(sets[0]!.evs, '');
  assert.deepEqual(estimated, []);
});

test('placings read as ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 112].map(placingLabel), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '112th']);
  assert.equal(placingLabel(null), '');
});
