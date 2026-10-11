import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { DexData, UsageData } from '../src/domain/dex.ts';
import { buildTeams, pasteSets } from '../scripts/teams-build.mjs';
import * as yt from '../scripts/teams-youtube.mjs';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dexData = read<DexData>('champions-mc.json');
const usageData = read<UsageData>('usage-mc.json');
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/teams/${name}`, import.meta.url), 'utf8');
const fixtureLoad = async (kind: string, key: string | number): Promise<string | null> => {
  const name = `${kind}-${key}.${['crob-team', 'pokepaste', 'vrpastes'].includes(kind) ? 'json' : 'html'}`;
  return existsSync(new URL(`./fixtures/teams/${name}`, import.meta.url)) ? fixture(name) : null;
};

test('YouTube: videos since the cut-off from a saved uploads page, and the paste links in their descriptions', () => {
  const page = yt.readPlaylistPage(fixture('youtube-playlist-UUYoTO-akZCsiusTe4rBxfhA.json'), yt.SINCE);
  assert.deepEqual(page.videos.map((v) => [v.id, v.date]), [['R8zUm6AYVEs', '2026-10-05'], ['nl7J2IYG2Ic', '2026-08-08']]);
  assert.equal(page.reachedSince, true);
  assert.ok(page.next);
  assert.equal(page.videos[0]!.url, 'https://www.youtube.com/watch?v=R8zUm6AYVEs');
  assert.equal(page.videos[0]!.channel, 'CybertronVGC');
  // "pokepast.es/<id>" written without https:// is a link too.
  assert.deepEqual(yt.descriptionLinks(page.videos[0]!.description).map((l) => l.id), ['0e35fd9cd52d7552']);
  const many = yt.descriptionLinks(page.videos[1]!.description);
  assert.equal(many.length, 14);
  assert.ok(many.every((l) => l.site === 'pokepaste' && l.api === `https://pokepast.es/${l.id}/json`));
  // Both sites, duplicates once, trailing punctuation dropped, other links ignored.
  const links = yt.descriptionLinks(
    'Team: https://pokepast.es/0e35fd9cd52d7552. Again pokepast.es/0e35fd9cd52d7552/raw and www.vrpastes.com/uQ8gaGGC, https://twitter.com/x',
  );
  assert.deepEqual(links.map((l) => `${l.site}:${l.id}`), ['pokepaste:0e35fd9cd52d7552', 'vrpastes:uQ8gaGGC']);
});

test('YouTube: the key is read from the environment first, and hidden in messages', () => {
  assert.equal(yt.readYoutubeKey('/nonexistent', { YOUTUBE_API_KEY: ' abc ' }), 'abc');
  assert.equal(yt.readYoutubeKey('/nonexistent', {}), '');
  assert.equal(yt.hideKey('403 for https://x/?key=SECRET1', 'SECRET1'), '403 for https://x/?key=<key>');
  assert.ok(!yt.playlistUrl('UUx', 'TOKEN', 'K').includes('~'));
  assert.deepEqual(yt.splitPlaylistKey(yt.playlistKey('UUx', 'TOKEN')), { playlistId: 'UUx', pageToken: 'TOKEN' });
});

test('a 252-EV paste becomes Stat Points the app’s way; a Stat Point paste is kept as it is', () => {
  const sets = pasteSets(
    'Incineroar @ Sitrus Berry\nAbility: Intimidate\nEVs: 252 HP / 4 Def / 252 SpD\nCareful Nature\n- Fake Out\n\n' +
      'Garchomp @ Garchompite Z\nAbility: Rough Skin\nEVs: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Protect',
  );
  assert.equal(sets[0]!.evs, '32 HP / 1 Def / 32 SpD');
  assert.equal(sets[0]!.nature, 'Careful');
  assert.equal(sets[1]!.evs, '2 HP / 32 Atk / 32 Spe');
});

test('sameTeam needs the same six species AND items; attachSpreads fills only empty spreads of the same nature', () => {
  const a = [
    { species: 'Incineroar', item: 'Sitrus Berry', nature: 'Careful' },
    { species: 'Garchomp', item: 'Garchompite Z', nature: 'Jolly' },
  ];
  const b = [
    { species: 'Garchomp', item: 'Garchompite Z', nature: 'Jolly', evs: '32 Atk / 32 Spe' },
    { species: 'Incineroar', item: 'Sitrus Berry', nature: 'Impish', evs: '32 HP / 32 Def' },
  ];
  assert.ok(yt.sameTeam(a, b));
  assert.ok(!yt.sameTeam(a, [b[0]!, { ...b[1]!, item: 'Leftovers' }]));
  const target = { sets: a.map((s) => ({ ...s })) as { species: string; item: string; nature: string; evs?: string }[] };
  assert.equal(yt.attachSpreads(target, b), 1);
  assert.equal(target.sets[1]!.evs, '32 Atk / 32 Spe');
  assert.equal(target.sets[0]!.evs, undefined); // Careful vs Impish: not this player's spread
});

test('the pipeline: a YouTube paste of an existing team adds its spreads to it; a new one is a creator team', async () => {
  // The Limitless fixture team, written out as a creator's paste with a 252-style spread.
  const base = await buildTeams({ load: fixtureLoad, dexData, usageData, sources: ['limitless'], today: '2026-10-10' });
  const recife = base.data.teams.find((t) => t.id === 'limitless-7178')!;
  const toPaste = (sets: typeof recife.sets, item?: string) =>
    sets
      .map((s, i) =>
        [`${s.species} @ ${i === 0 && item ? item : s.item}`, `Ability: ${s.ability}`, 'EVs: 252 HP / 4 Def / 252 Spe', `${s.nature} Nature`, ...s.moves.map((m) => `- ${m}`)].join('\n'),
      )
      .join('\n\n');
  const otherItem = 'Focus Sash'; // on nobody else, so Item Clause still holds
  assert.ok(!recife.sets.some((s) => s.item === otherItem));
  const pastes: Record<string, string> = {
    aaaaaaaa11111111: toPaste(recife.sets),
    bbbbbbbb22222222: toPaste(recife.sets, otherItem),
  };
  const playlist = {
    items: [
      { snippet: { publishedAt: '2026-10-09T15:00:00Z', title: 'Same team', description: 'pokepast.es/aaaaaaaa11111111', channelTitle: 'Creator', resourceId: { videoId: 'vid1' } } },
      { snippet: { publishedAt: '2026-10-08T15:00:00Z', title: 'Other item', description: 'https://pokepast.es/bbbbbbbb22222222', channelTitle: 'Creator', resourceId: { videoId: 'vid2' } } },
    ],
  };
  const load = async (kind: string, key: string | number): Promise<string | null> => {
    if (kind === 'youtube-channel') return JSON.stringify({ items: [{ id: 'UC1', snippet: { title: 'Creator' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
    if (kind === 'youtube-playlist') return JSON.stringify(playlist);
    if (kind === 'pokepaste') return pastes[key] ? JSON.stringify({ title: '', paste: pastes[key] }) : null;
    return fixtureLoad(kind, key);
  };
  const { data, youtube } = await buildTeams({ load, dexData, usageData, sources: ['limitless', 'youtube'], today: '2026-10-10' });
  const merged = data.teams.find((t) => t.id === 'limitless-7178')!;
  assert.ok(merged.sets.every((s) => s.evs === '32 HP / 1 Def / 32 Spe'));
  assert.equal(merged.spreadSource, 'youtube');
  assert.equal(merged.spreadUrl, 'https://www.youtube.com/watch?v=vid1');
  const added = data.teams.find((t) => t.source === 'youtube')!;
  assert.equal(added.id, 'youtube-vid2-bbbbbbbb22222222');
  assert.deepEqual([added.tier, added.placing, added.player, added.event, added.date, added.sourceUrl], ['creator', null, 'Creator', 'Other item', '2026-10-08', 'https://www.youtube.com/watch?v=vid2']);
  assert.equal(added.spreadSource, 'youtube');
  assert.equal(data.teams.at(-1), added); // creator teams sort last
  assert.equal(youtube?.merged, 1);
  assert.equal(youtube?.added, 1);
  assert.equal(data.sources.find((s) => s.id === 'youtube')?.merged, 1);
});
