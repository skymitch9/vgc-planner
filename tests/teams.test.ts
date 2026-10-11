import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Dex, setProblems, teamProblems, toID, type DexData, type UsageData } from '../src/domain/dex.ts';
import { TIERS, TIER_LABEL, teamSets, type TopTeamsData, type TournamentTeam } from '../src/domain/teams.ts';
import { buildTeams } from '../scripts/teams-build.mjs';
import { compareTeams, makeResolver, normaliseSet } from '../scripts/teams-common.mjs';
import * as crob from '../scripts/teams-crob.mjs';
import * as limitless from '../scripts/teams-limitless.mjs';
import * as vr from '../scripts/teams-victoryroad.mjs';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')) as T;
const dexData = read<DexData>('champions-mc.json');
const usageData = read<UsageData>('usage-mc.json');
const dex = new Dex(dexData, usageData);
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/teams/${name}`, import.meta.url), 'utf8');
const fixtureLoad = async (kind: string, key: string | number): Promise<string | null> => {
  const name = `${kind}-${key}.${['crob-team', 'pokepaste', 'vrpastes'].includes(kind) ? 'json' : 'html'}`;
  return existsSync(new URL(`./fixtures/teams/${name}`, import.meta.url)) ? fixture(name) : null;
};

// ---- Parsers on saved pages -----------------------------------------------------------------------------------

test('Limitless listing: rows grouped under their event, with placing, player and species', () => {
  const rows = limitless.parseListing(fixture('limitless-listing-1.html'));
  assert.deepEqual(rows[0], {
    teamId: 7178,
    tournamentId: 444,
    event: 'Regional Recife',
    date: '2026-10-03',
    placing: 1,
    playerId: 1096,
    player: 'Juan Francisco Salerno',
    species: ['Sylveon', 'Toxapex', 'Garchomp', 'Venusaur', 'Charizard', 'Incineroar'],
  });
  assert.equal(rows.length, 6);
  const rios = rows.find((r) => r.player === 'Eric Rios')!;
  assert.deepEqual([rios.teamId, rios.tournamentId, rios.event, rios.date, rios.placing], [7038, 443, 'Regional Frankfurt', '2026-09-26', 1]);
  // A team shared by two players appears once per player.
  const shared = rows.filter((r) => r.teamId === 6859);
  assert.deepEqual(shared.map((r) => [r.event, r.placing, r.species.length]), [['Regional Frankfurt', 139, 6], ['Regional Baltimore, MD', 1, 6]]);
  assert.equal(limitless.limitlessTier('Regional Recife'), 'regional');
  assert.equal(limitless.limitlessTier('World Championships 2026'), 'worlds');
  assert.equal(limitless.limitlessTier('NAIC 2026, New Orleans'), 'international');
});

test('Limitless team page: six sets (Megas as base species + stone) and where the team placed', () => {
  const page = limitless.parseTeamPage(fixture('limitless-team-7178.html'));
  assert.equal(page.sets.length, 6);
  assert.deepEqual(page.sets[0], { id: 'sylveon', name: 'Sylveon', item: 'Fairy Feather', ability: 'Pixilate', nature: 'Modest', moves: ['Hyper Voice', 'Yawn', 'Quick Attack', 'Protect'] });
  assert.deepEqual(page.sets[4]!.item, 'Charizardite Y');
  assert.deepEqual(page.results, [{ placing: 1, tournamentId: 444, event: 'Regional Recife', playerId: 1096, player: 'Juan Francisco Salerno' }]);
  const sizes = limitless.parseTournaments(fixture('limitless-tournaments-all.html'));
  assert.equal(sizes.get(444)?.players, 222);
  assert.equal(sizes.get(437)?.players, 395);
});

test('crob.at: listing cards and page count, and the API JSON reduced to the team', () => {
  const listing = crob.parseListing(fixture('crob-listing-1.html'));
  assert.equal(listing.pages, 21);
  assert.equal(listing.cards.length, 3);
  assert.ok(listing.cards.every((c) => c.format === 'gen9championsvgc2026regmc'));
  assert.ok(listing.cards.some((c) => c.slug === 'tq7KCk'));

  const team = crob.parseTeam(fixture('crob-team-tq7KCk.json'))!;
  assert.equal(team.slug, 'tq7KCk');
  assert.equal(team.event, "Maddo's Cup #12 | 100€ for the Winner | Reg M-C");
  assert.equal(team.date, '2026-09-19');
  assert.equal(team.placing, 1);
  assert.equal(team.fieldSize, 388);
  assert.equal(team.sourceUrl, 'https://play.limitlesstcg.com/tournament/6a9c5234a4272c53be6480bf/player/luca');
  assert.match(team.paste, /^Salamence @ Salamencite\nAbility: Intimidate/);
  assert.doesNotMatch(team.paste, /EVs:/);
  assert.equal(crob.crobPlayer(team), 'Luca');
  const other = { ...JSON.parse(fixture('crob-team-tq7KCk.json')), teams: [{ format: 'gen9vgc2026regi', paste: 'Pikachu' }] };
  assert.equal(crob.parseTeam(other), null);
});

test('Victory Road: only the Reg M-C rows, with codes, results, flags and paste links', () => {
  const rows = vr.parsePage(fixture('victoryroad-page.html'), '2026-10-10');
  // 4 finals rows + 2 ranked rows; the legacy row after "Past formats" is not read.
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], {
    section: 'Teams reaching finals of large tournaments',
    country: 'ESP',
    player: 'Eric Rios',
    handle: 'Riopaser',
    event: 'Frankfurt Regional Championships',
    eventUrl: 'https://victoryroad.pro/2027-frankfurt/',
    result: 'Champion',
    placing: 1,
    tier: 'regional',
    date: '2026-09-26',
    species: ['Garchomp Mega Z', 'Raichu Mega Y', 'Incineroar', 'Gholdengo', 'Volcarona', 'Rillaboom'],
    replicaCodes: ['9NNN3', 'N8A4G'],
    pasteUrl: null,
    replayUrl: null,
  });
  const alpensee = rows.find((r) => r.event === 'Alpensee Tour #74')!;
  assert.deepEqual([alpensee.tier, alpensee.placing, alpensee.pasteUrl], ['online', 1, 'https://www.vrpastes.com/qZK7HCqj']);
  const ranked = rows.filter((r) => /ranked/i.test(r.section));
  assert.deepEqual(ranked.map((r) => [r.tier, r.placing, r.date]), [['ranked', 13, '2026-10-07'], ['ranked', null, '2026-09-12']]);
  assert.equal(vr.vrPlacing('Top 8'), 8);
  assert.equal(vr.vrPlacing('Finalist'), 2);
  // No year on the page: the latest such date on or before today.
  assert.equal(vr.vrDate('December 5th', '2026-10-10'), '2025-12-05');
});

test('names from every site resolve to the dex: regional forms, genders, Megas, accents', () => {
  const r = makeResolver(dexData);
  assert.deepEqual(r.species('Hisuian Arcanine'), { species: 'Arcanine-Hisui' });
  assert.deepEqual(r.species('Paldean Tauros Aqua Breed'), { species: 'Tauros-Paldea-Aqua' });
  assert.deepEqual(r.species('Female Indeedee'), { species: 'Indeedee-F' });
  assert.deepEqual(r.species('Indeedee ♀'), { species: 'Indeedee-F' });
  assert.deepEqual(r.species('Eternal Flower Floette'), { species: 'Floette-Eternal' });
  assert.deepEqual(r.species('Heat Rotom'), { species: 'Rotom-Heat' });
  assert.deepEqual(r.species('Garchomp Mega Z'), { species: 'Garchomp', item: 'Garchompite Z' });
  assert.deepEqual(r.species('Meowstic F Mega'), { species: 'Meowstic-F', item: 'Meowsticite' });
  assert.deepEqual(r.species('Alcremie Rainbow Swirl'), { species: 'Alcremie' });
  assert.equal(r.species('Iron Hands'), null);
  assert.equal(r.nature('Naïve'), 'Naive');
  assert.match(normaliseSet({ species: 'Garchomp', item: 'Not An Item' }, r).error!, /unknown item/);
  // "Floette @ Floettite": the stone names the only Floette the format has.
  assert.equal(normaliseSet({ species: 'Floette', item: 'Floettite', moves: ['Protect'] }, r).set?.species, 'Floette-Eternal');
  assert.match(normaliseSet({ species: 'Floette', item: 'Leftovers' }, r).error!, /unknown species/);
  // A paste exported from the Mega carries the Mega's ability; the base form gets one it can have.
  const zard = normaliseSet({ species: 'Charizard', item: 'Charizardite Y', ability: 'Drought', moves: ['Heat Wave', '-'] }, makeResolver(dexData, usageData));
  assert.ok(dex.species('Charizard')!.abilities.includes(zard.set!.ability), zard.set!.ability);
  assert.match(zard.note!, /Mega ability Drought/);
  assert.deepEqual(zard.set!.moves, ['Heat Wave']);
  // An ability that is nobody's Mega ability stays, for the legality check to reject.
  assert.equal(normaliseSet({ species: 'Garchomp', item: 'Choice Scarf', ability: 'Levitate' }, r).set?.ability, 'Levitate');
});

test('the whole pipeline over the fixtures: merging codes onto the official team, real spreads only from pastes', async () => {
  const { data } = await buildTeams({ load: fixtureLoad, dexData, usageData, today: '2026-10-10' });
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  // Victory Road's Frankfurt champion is Limitless team 7038 (same six, same surname): codes attached, not duplicated.
  const rios = byId.get('limitless-7038')!;
  assert.deepEqual(rios.replicaCodes, ['9NNN3', 'N8A4G']);
  assert.equal(rios.country, 'ESP');
  assert.ok(!data.teams.some((t) => t.id === 'victoryroad-9NNN3N8A4G'));
  assert.equal(data.sources.find((s) => s.id === 'victoryroad')?.merged, 1);
  // The Alpensee row's vrpastes link is the same team, so its published Stat Points are kept.
  const alpensee = byId.get('victoryroad-7F8MM0LD1F')!;
  assert.equal(alpensee.setsKnown, true);
  assert.equal(alpensee.sets.find((s) => s.species === 'Gengar')?.evs, '30 HP / 13 Def / 16 SpD / 7 Spe');
  // The "early meta" row links the same paste, but it is a different team: species only, no invented sets.
  const early = byId.get('victoryroad-X9G48T91TN')!;
  assert.equal(early.setsKnown, false);
  assert.ok(early.sets.every((s) => !s.evs && !s.moves.length));
  assert.equal(early.sets.find((s) => s.species === 'Charizard')?.item, 'Charizardite Y');
  // Limitless and crob publish no spreads.
  assert.ok(data.teams.filter((t) => t.source !== 'victoryroad').every((t) => t.sets.every((s) => !s.evs)));
  assert.equal(byId.get('crob-tq7KCk')?.sets[2]?.species, 'Arcanine-Hisui');
  assert.deepEqual([...data.teams].sort(compareTeams).map((t) => t.id), data.teams.map((t) => t.id));
  assert.equal(data.teams[0]!.id, 'limitless-7178');
});

// ---- Domain helpers -------------------------------------------------------------------------------------------

test('teamSets: published spreads are kept; missing ones come from usage and are named', () => {
  const base = { id: 'x', source: 'crob', event: 'E', date: '2026-10-01', tier: 'online', placing: 1, player: 'P', sourceUrl: 'u', setsKnown: true } as const;
  const team: TournamentTeam = {
    ...base,
    sets: [
      { species: 'Incineroar', item: 'Sitrus Berry', ability: 'Intimidate', nature: 'Careful', moves: ['Fake Out'], evs: '32 HP / 2 Def / 32 SpD' },
      { species: 'Garchomp', item: 'Garchompite Z', ability: 'Rough Skin', nature: '', moves: ['Protect'] },
    ],
  };
  const { sets, estimated } = teamSets(team, dex);
  assert.equal(sets[0]!.evs, '32 HP / 2 Def / 32 SpD');
  assert.equal(sets[0]!.nature, 'Careful');
  assert.equal(sets[0]!.level, 50);
  assert.deepEqual(estimated, ['Garchomp']);
  const chompUsage = dex.usageFor(dex.species('Garchomp')).find((u) => u.mega === 'Garchompite Z')!;
  assert.equal(sets[1]!.nature, chompUsage.spreads[0]![0]);
  assert.ok(sets[1]!.evs);
  // Without usage data nothing is estimated.
  assert.deepEqual(teamSets(team, new Dex(dexData)).estimated, []);
  assert.equal(TIER_LABEL.worlds, 'World Championships');
  assert.equal(TIERS.length, Object.keys(TIER_LABEL).length);
});

// ---- The generated data ---------------------------------------------------------------------------------------

const DATA_FILE = new URL('../src/data/teams-mc.json', import.meta.url);
const data: TopTeamsData = existsSync(DATA_FILE) ? read<TopTeamsData>('teams-mc.json') : { format: '', generated: '', sources: [], teams: [] };
const needsData = { skip: !existsSync(DATA_FILE) && 'src/data/teams-mc.json not generated yet (npm run teams)' };

test('teams-mc.json: six different Pokémon of the format on every team, unique ids, every source present', needsData, () => {
  assert.equal(data.format, dexData.format);
  const ids = new Set<string>();
  for (const t of data.teams) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.equal(t.sets.length, 6, t.id);
    // Each species is the dex's own name for it (not a Mega form name: Megas are the base species + stone).
    for (const s of t.sets) assert.equal(dex.species(s.species)?.name, s.species, t.id);
    assert.equal(new Set(t.sets.map((s) => toID(s.species))).size, 6, t.id);
    assert.match(t.date, /^\d{4}-\d\d-\d\d$/, t.id);
    assert.ok(TIERS.includes(t.tier), t.id);
    for (const c of t.replicaCodes ?? []) assert.match(c, /^[A-Z0-9]{5}$/, t.id);
  }
  for (const source of ['limitless', 'crob', 'victoryroad'] as const) {
    assert.ok(data.teams.some((t) => t.source === source), `no ${source} teams`);
    assert.equal(data.sources.find((s) => s.id === source)?.teams, data.teams.filter((t) => t.source === source).length);
  }
});

test('teams-mc.json: every team with known sets is legal, with or without estimated spreads', needsData, () => {
  const problems: string[] = [];
  for (const t of data.teams.filter((x) => x.setsKnown)) {
    for (const d of [dex, new Dex(dexData)]) {
      const { sets } = teamSets(t, d);
      const p = [...sets.flatMap((s) => setProblems(s, d)), ...teamProblems(sets, d)];
      if (p.length) problems.push(`${t.id}: ${p.join(' ')}`);
    }
    // Names are already the dex's own spelling.
    for (const s of t.sets) {
      if (s.item) assert.equal(dex.item(s.item)?.name, s.item, t.id);
      assert.equal(dex.ability(s.ability), s.ability, t.id);
      for (const m of s.moves) assert.equal(dex.move(m)?.name, m, t.id);
      if (s.nature) assert.equal(dex.nature(s.nature)?.name, s.nature, t.id);
    }
  }
  assert.deepEqual(problems, []);
});

test('teams-mc.json: sorted by tier, then placing, then newest', needsData, () => {
  const sorted = [...data.teams].sort(compareTeams);
  assert.deepEqual(data.teams.map((t) => t.id), sorted.map((t) => t.id));
});
