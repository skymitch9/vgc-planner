import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newPlan, newTeam } from '../src/domain/model.ts';
import { LocalStoragePrefs } from '../src/infra/prefs.ts';
import { LocalStorageRepository, MemoryRepository, RepositoryError, StaleLibraryError } from '../src/infra/repository.ts';
import type { StorageChange, StorageEvents, StorageLike } from '../src/infra/repository.ts';
import type { Library } from '../src/domain/types.ts';
import { AppStore } from '../src/state/store.ts';

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { if (this.failWrites) throw new Error('quota'); this.data.set(k, v); }
}

test('saves and loads the library', async () => {
  const storage = new FakeStorage();
  const repo = new LocalStorageRepository(storage, 'lib');
  const team = newTeam('A', 'Rillaboom'); team.plans.push(newPlan('p'));
  await repo.save({ teams: [team] });
  const loaded = await repo.load();
  assert.equal(loaded.teams[0]?.plans[0]?.name, 'p');
});

test('an empty storage gives an empty library', async () => {
  assert.deepEqual(await new LocalStorageRepository(new FakeStorage(), 'lib').load(), { teams: [] });
});

test('migrates data from the legacy key without losing it', async () => {
  const storage = new FakeStorage();
  const team = newTeam('Old', 'Rillaboom');
  storage.setItem('legacy', JSON.stringify({ teams: [team], ui: { teamId: team.id, zoom: 0.8, open: { [team.id]: true } } }));
  const repo = new LocalStorageRepository(storage, 'lib', 'legacy');
  assert.equal((await repo.load()).teams[0]?.name, 'Old');
  const prefs = new LocalStoragePrefs(storage, 'prefs', 'legacy').load();
  assert.equal(prefs.teamId, team.id);
  assert.equal(prefs.zoom, 0.8);
  assert.equal(prefs.open[team.id], true);
});

test('unreadable data is backed up, never overwritten silently', async () => {
  const storage = new FakeStorage();
  storage.setItem('lib', '{not json');
  await assert.rejects(new LocalStorageRepository(storage, 'lib').load(), RepositoryError);
  assert.ok([...storage.data.keys()].some((k) => k.startsWith('lib:unreadable-')));
});

test('a full or blocked storage reports a clear error on save', async () => {
  const storage = new FakeStorage();
  storage.failWrites = true;
  await assert.rejects(new LocalStorageRepository(storage, 'lib').save({ teams: [] }), /storage is full/);
});

test('store restores the last open plan from preferences and reports save errors', async () => {
  const storage = new FakeStorage();
  const repo = new LocalStorageRepository(storage, 'lib');
  const prefs = new LocalStoragePrefs(storage, 'prefs');
  const team = newTeam('A', ''); const plan = newPlan('p'); team.plans.push(plan);
  await repo.save({ teams: [team] });
  prefs.save({ teamId: team.id, planId: plan.id, tabId: null, open: {}, zoom: 5, navCollapsed: true, teamFeedUrl: 'https://teams.example/feed.json' });
  const store = new AppStore(repo, prefs);
  await store.init();
  assert.equal(store.plan?.id, plan.id);
  assert.equal(store.ui.zoom, 1.6, 'zoom is clamped to the allowed range');
  assert.equal(store.ui.navCollapsed, true, 'the collapsed sidebar is remembered');
  assert.equal(store.ui.teamFeedUrl, 'https://teams.example/feed.json', 'the chosen team feed is remembered');
  store.ui.teamFeedUrl = '';
  await store.flush();
  assert.equal(prefs.load().teamFeedUrl, '', 'clearing the feed is remembered too');
  assert.equal(store.ui.importUrl, null, 'no backup address until one is used');
  store.ui.importUrl = 'https://files.example/backup.json';
  await store.flush();
  assert.equal(prefs.load().importUrl, 'https://files.example/backup.json', 'the last backup address is remembered');

  const errors: string[] = [];
  store.onError = (m) => errors.push(m);
  storage.failWrites = true;
  await store.flush();
  assert.equal(errors.length, 1);
});

test('store reopens the remembered plan once the library that holds it loads', async () => {
  const storage = new FakeStorage();
  const prefs = new LocalStoragePrefs(storage, 'prefs');
  const team = newTeam('A', ''); const plan = newPlan('p'); team.plans.push(plan);
  const account = new MemoryRepository();
  await account.save({ teams: [team] });
  prefs.save({ teamId: team.id, planId: plan.id, tabId: null, open: {}, zoom: 1, navCollapsed: false });
  const store = new AppStore(new MemoryRepository(), prefs);
  await store.init();
  assert.equal(store.ui.planId, null, 'the device library does not hold the plan');
  await store.flush();
  assert.equal(prefs.load().planId, plan.id, 'the remembered plan is not overwritten before the account loads');

  await store.useRepository(account);
  assert.equal(store.plan?.id, plan.id);
  assert.equal(store.ui.tabId, plan.tabs[0]?.id);
});

test('MemoryRepository isolates stored data from later mutation', async () => {
  const repo = new MemoryRepository();
  const lib = { teams: [newTeam('A')] };
  await repo.save(lib);
  lib.teams[0]!.name = 'changed';
  assert.equal((await repo.load()).teams[0]?.name, 'A');
});

/* --------------------------- several open tabs --------------------------- */

/** Stands in for `window`: `fire` delivers a `storage` event the way the browser does in the other tabs. */
class FakeEvents implements StorageEvents {
  listeners = new Set<(e: StorageChange) => void>();
  addEventListener(_type: 'storage', fn: (e: StorageChange) => void): void { this.listeners.add(fn); }
  removeEventListener(_type: 'storage', fn: (e: StorageChange) => void): void { this.listeners.delete(fn); }
  fire(key: string | null): void { for (const fn of this.listeners) fn({ key }); }
}

const stored = (storage: FakeStorage): { revision?: number; savedAt?: string; teams: { name: string }[] } =>
  JSON.parse(storage.getItem('lib')!) as { revision?: number; savedAt?: string; teams: { name: string }[] };

/** One tab: its own repository, events and store over the shared storage. */
async function openTab(storage: FakeStorage): Promise<{ store: AppStore; events: FakeEvents; repo: LocalStorageRepository; external: number[] }> {
  const events = new FakeEvents();
  const repo = new LocalStorageRepository(storage, 'lib', null, events);
  const store = new AppStore(repo, new LocalStoragePrefs(storage, 'prefs'));
  const external: number[] = [];
  store.onExternalChange = () => external.push(1);
  await store.init();
  return { store, events, repo, external };
}

test('each save stamps a higher revision and a time; older envelopes without them still load', async () => {
  const storage = new FakeStorage();
  storage.setItem('lib', JSON.stringify({ schemaVersion: 2, teams: [newTeam('Old', '')] }));
  const repo = new LocalStorageRepository(storage, 'lib');
  const lib = await repo.load();
  assert.equal(lib.teams[0]?.name, 'Old');
  await repo.save(lib);
  assert.equal(stored(storage).revision, 1);
  assert.ok(!Number.isNaN(Date.parse(stored(storage).savedAt!)));
  await repo.save(lib);
  assert.equal(stored(storage).revision, 2);
  assert.equal((await new LocalStorageRepository(storage, 'lib').load()).teams[0]?.name, 'Old', 'the stamped envelope reads back');
});

test('a save refuses to write over a library another tab saved since this one read it', async () => {
  const storage = new FakeStorage();
  const a = new LocalStorageRepository(storage, 'lib');
  const b = new LocalStorageRepository(storage, 'lib');
  await a.load(); await b.load();
  await a.save({ teams: [newTeam('From A', '')] });
  const err = await b.save({ teams: [newTeam('From B', '')] }).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof StaleLibraryError);
  assert.deepEqual(err.stored.teams.map((t) => t.name), ['From A'], 'the newer library is handed back');
  assert.deepEqual(stored(storage).teams.map((t) => t.name), ['From A'], 'nothing was written');
  await b.save({ teams: [newTeam('Merged', '')] });
  assert.deepEqual(stored(storage).teams.map((t) => t.name), ['Merged'], 'once handed back, it counts as read');
});

test('a storage event for the library hands over the stored library once; other keys are ignored', async () => {
  const storage = new FakeStorage();
  const a = new LocalStorageRepository(storage, 'lib');
  const b = new LocalStorageRepository(storage, 'lib');
  await a.load(); await b.load();
  const got: Library[] = [];
  b.handleStorageEvent({ key: 'lib' }, (lib) => got.push(lib));
  assert.equal(got.length, 0, 'nothing new yet');
  await a.save({ teams: [newTeam('From A', '')] });
  b.handleStorageEvent({ key: 'prefs' }, (lib) => got.push(lib));
  assert.equal(got.length, 0);
  b.handleStorageEvent({ key: 'lib' }, (lib) => got.push(lib));
  b.handleStorageEvent({ key: 'lib' }, (lib) => got.push(lib));
  assert.equal(got.length, 1, 'a repeated event for the same save is ignored');
  assert.equal(got[0]!.teams[0]!.name, 'From A');
  storage.setItem('lib', '{broken');
  b.handleStorageEvent({ key: 'lib' }, (lib) => got.push(lib));
  assert.equal(got.length, 1, 'unreadable data is left alone');
});

test('a storage event merges another tab\'s save into the store and keeps local unsaved edits', async () => {
  const storage = new FakeStorage();
  const seed = new LocalStorageRepository(storage, 'lib');
  const one = newTeam('One', ''); const two = newTeam('Two', '');
  await seed.save({ teams: [one, two] });
  const tabA = await openTab(storage);
  const tabB = await openTab(storage);

  // A adds a team and saves; B hears of it without reloading.
  tabA.store.library.teams.push(newTeam('Added in A', ''));
  await tabA.store.flush();
  tabB.events.fire('lib');
  assert.deepEqual(tabB.store.library.teams.map((t) => t.name), ['One', 'Two', 'Added in A']);
  assert.equal(tabB.external.length, 1, 'B is told (toast and redraw)');

  // B has an unsaved rename of One when A's rename of Two arrives: both survive.
  tabB.store.library.teams[0]!.name = 'One (B)';
  tabB.store.persist();
  tabA.store.library.teams[1]!.name = 'Two (A)';
  await tabA.store.flush();
  tabB.events.fire('lib');
  assert.deepEqual(tabB.store.library.teams.map((t) => t.name), ['One (B)', 'Two (A)', 'Added in A']);
  await tabB.store.flush();
  assert.deepEqual(stored(storage).teams.map((t) => t.name), ['One (B)', 'Two (A)', 'Added in A']);
  tabA.events.fire('lib');
  assert.deepEqual(tabA.store.library.teams.map((t) => t.name), ['One (B)', 'Two (A)', 'Added in A']);
  assert.equal(tabA.store.saveState, 'saved', 'nothing left to save in A');
});

test('a save from a tab that missed the event merges first instead of overwriting (the lost-rename incident)', async () => {
  const storage = new FakeStorage();
  const seed = new LocalStorageRepository(storage, 'lib');
  const owner = newTeam('Sal Z', '');
  await seed.save({ teams: [owner] });
  const oldTab = await openTab(storage); // loaded long ago; its events never arrive
  const ownerTab = await openTab(storage);
  ownerTab.store.library.teams[0]!.name = 'Garchomp Z';
  ownerTab.store.library.teams.push(newTeam('Salamence', ''));
  await ownerTab.store.flush();

  oldTab.store.library.teams.push(newTeam('Imported 1', ''), newTeam('Imported 2', ''));
  await oldTab.store.flush();
  const all = ['Garchomp Z', 'Imported 1', 'Imported 2', 'Salamence'];
  assert.deepEqual(stored(storage).teams.map((t) => t.name), all, 'the rename and the new team survive; the imports are added');
  assert.deepEqual(oldTab.store.library.teams.map((t) => t.name), all);
  assert.equal(oldTab.external.length, 1);
  assert.equal(oldTab.store.saveState, 'saved');
});

test('a merge that drops the open team or gameplan clears the selection', async () => {
  const storage = new FakeStorage();
  const seed = new LocalStorageRepository(storage, 'lib');
  const team = newTeam('T', ''); const plan = newPlan('p'); team.plans.push(plan);
  await seed.save({ teams: [team] });
  const tabA = await openTab(storage);
  const tabB = await openTab(storage);
  tabB.store.ui.teamId = team.id; tabB.store.ui.planId = plan.id;
  tabA.store.library.teams[0]!.plans.length = 0;
  await tabA.store.flush();
  tabB.events.fire('lib');
  assert.equal(tabB.store.ui.teamId, team.id);
  assert.equal(tabB.store.ui.planId, null, 'the gameplan deleted in A is closed in B');
});
