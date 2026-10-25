/**
 * A library saved before the upstream merge of 2026-10-24 must load in the merged app without loss. The fixture
 * `library-fork-947a764.json` was written by `writeLibrary` of skymitch9/vgc-planner at 947a764 (the last commit
 * before the merge), stamped revision 12, exactly as that build keeps it under `vgc-planner:library`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { config } from '../src/config.ts';
import { readLibrary, readLibraryStamp, writeLibrary } from '../src/domain/codec.ts';
import { LocalStoragePrefs } from '../src/infra/prefs.ts';
import { LocalStorageRepository, type StorageLike } from '../src/infra/repository.ts';
import { AppStore } from '../src/state/store.ts';

const FIXTURE = readFileSync(new URL('./fixtures/library-fork-947a764.json', import.meta.url), 'utf8');
const stored = (): unknown => JSON.parse(FIXTURE) as unknown;

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
}

test('a library saved by the fork before the upstream merge reads and writes back unchanged', () => {
  const raw = stored();
  const lib = readLibrary(raw);
  assert.deepEqual(lib.teams.map((t) => [t.name, t.plans.length]), [['Fork Team A', 2], ['Fork Team B (copy)', 0]]);
  assert.deepEqual(lib.teams[0]!.estimatedSpreads, ['Incineroar']);
  assert.deepEqual(readLibraryStamp(raw), { revision: 12, savedAt: '2026-10-24T21:40:00.000Z' });
  // Nothing added, dropped or reshaped: written back with the same stamp it is the same JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(writeLibrary(lib, readLibraryStamp(raw)))), raw);
});

test('a pre-merge library keeps every turn, outcome and line; the new 5th-turn-bound flag round-trips', () => {
  const lib = readLibrary(stored());
  const turn1 = lib.teams[0]!.plans[0]!.tabs[0]!.children[0]!;
  assert.equal(turn1.line?.name, 'Plan A');
  assert.deepEqual(turn1.tieOrder, ['me:Rillaboom', 'opp:Garchomp']);
  assert.deepEqual(turn1.actions[2]!.outcome, { targets: { Rillaboom: { crit: true, hp: 40 } } });
  assert.equal(turn1.actions[1]!.pivot, 'Rillaboom');
  assert.deepEqual(turn1.children[0]!.hpEnd, { 'me:Rillaboom': 40 });
  assert.ok(!('stillBound' in turn1.actions[3]!.outcome!), 'older outcomes gain nothing');
  turn1.actions[3]!.outcome = { stillBound: true };
  const again = readLibrary(JSON.parse(JSON.stringify(writeLibrary(lib))));
  assert.deepEqual(again.teams[0]!.plans[0]!.tabs[0]!.children[0]!.actions[3]!.outcome, { stillBound: true });
});

test('the merged app opens a pre-merge library and preferences, then saves on top of revision 12', async () => {
  const storage = new FakeStorage();
  storage.setItem(config.storage.libraryKey, FIXTURE);
  storage.setItem(config.storage.prefsKey, JSON.stringify({
    teamId: 'team-rain', planId: 'plan-1', tabId: 'tab-1', open: {}, zoom: 1, navCollapsed: false,
    teamFeedUrl: 'https://feed.example/feed.json', importUrl: 'https://files.example/backup.json',
  }));
  // What is kept on this device for the news box lives under its own key and never touches the library.
  storage.setItem('vgc-planner:news-seen', '2');
  const store = new AppStore(
    new LocalStorageRepository(storage, config.storage.libraryKey, config.storage.legacyKey),
    new LocalStoragePrefs(storage, config.storage.prefsKey, config.storage.legacyKey),
  );
  await store.init();
  assert.equal(store.loadError, null);
  assert.equal(store.library.teams.length, 2);
  assert.equal(store.team?.name, 'Fork Team A', 'the open team is restored');
  assert.equal(store.plan?.name, 'vs Chomp TR', 'the open gameplan is restored');
  assert.equal(store.ui.teamFeedUrl, 'https://feed.example/feed.json');
  assert.equal(store.ui.importUrl, 'https://files.example/backup.json');

  store.library.teams[1]!.name = 'Renamed after the merge';
  store.persist();
  await store.flush();
  const after = JSON.parse(storage.getItem(config.storage.libraryKey)!) as unknown;
  assert.equal(readLibraryStamp(after).revision, 13, 'the save continues the stored revision');
  const expected = readLibrary(stored());
  expected.teams[1]!.name = 'Renamed after the merge';
  assert.deepEqual(readLibrary(after), expected, 'every team and gameplan is still there after the save');
  const prefs = JSON.parse(storage.getItem(config.storage.prefsKey)!) as Record<string, unknown>;
  assert.equal(prefs.teamFeedUrl, 'https://feed.example/feed.json');
  assert.equal(prefs.importUrl, 'https://files.example/backup.json');
  assert.equal(prefs.planId, 'plan-1');
});
