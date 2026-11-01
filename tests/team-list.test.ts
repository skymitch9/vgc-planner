/**
 * The official team list: the two pages drawn from a paste and the player's details, the details kept apart from the
 * library (never in an export, the stored library or the account-sync snapshot), and the team page's top bar unchanged
 * apart from the one new button.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../src/config.ts';
import { buildExport, writeLibrary } from '../src/domain/codec.ts';
import { snapshotLibrary } from '../src/domain/library-sync.ts';
import { newPlan, newTeam } from '../src/domain/model.ts';
import { REGULATION } from '../src/domain/regulation.ts';
import { parseShowdown } from '../src/domain/showdown.ts';
import type { PlayerDetails } from '../src/domain/team-list.ts';
import { battleTeamFor, emptyDetails, emptyDetailsFile, readDetailsFile, teamListMons } from '../src/domain/team-list.ts';
import type { Library } from '../src/domain/types.ts';
import { PlayerDetailsStore } from '../src/infra/player-details.ts';
import { esc } from '../src/ui/dom.ts';
import { teamListPagesHTML } from '../src/ui/team-list-pages.ts';
import { teamListButton, teamTopbarHTML } from '../src/ui/views/team-topbar.ts';

const PASTE = `Charizard-Mega-Y @ Charizardite Y
Ability: Solar Power
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Heat Wave
- Solar Beam
- Protect
- Weather Ball

Venusaur @ Life Orb
Ability: Chlorophyll
EVs: 32 HP / 32 SpA / 2 Spe
Modest Nature
- Sleep Powder
- Giga Drain
- Earth Power
- Protect

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 16 Def / 18 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- Knock Off

Garchomp @ Choice Scarf
Ability: Rough Skin
EVs: 32 Atk / 2 Def / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Stomping Tantrum

Tauros-Paldea-Aqua @ Mystic Water
Ability: Intimidate
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Wave Crash
- Close Combat
- Protect
- Aqua Jet

Sinistcha @ Rocky Helmet
Ability: Hospitality
EVs: 32 HP / 32 Def / 2 SpD
Bold Nature
- Matcha Gotcha
- Rage Powder
- Trick Room
- Life Dew`;

const DETAILS: PlayerDetails = {
  playerName: 'Zed Q. Sampleperson', ageDivision: 'Masters', trainerName: 'TrainerXq', playerId: '9876543',
  dobMonth: '07', dobDay: '23', dobYear: '1991', switchProfile: 'ProfileQz', supportId: 'SUPP9Q',
};

const pages = (html: string): [string, string] => {
  const parts = html.split('<section class="tl-page">').slice(1);
  assert.equal(parts.length, 2, 'exactly two pages');
  return [parts[0]!, parts[1]!];
};
const boxes = (pageHtml: string): string[] => pageHtml.split(/<div class="tl-mon(?: with-stats)?">/).slice(1);
const valueOf = (box: string, label: string): string | undefined =>
  box.match(new RegExp(`<span class="tl-label">${label}</span><span class="tl-value">([^<]*)</span>`))?.[1];

test('both pages list the six Pokémon in paste order; page 1 adds their Stat Points', () => {
  const [p1, p2] = pages(teamListPagesHTML(parseShowdown(PASTE), DETAILS, 'Sun Team'));
  for (const p of [p1, p2]) {
    const b = boxes(p);
    assert.equal(b.length, REGULATION.teamSize);
    assert.deepEqual(b.map((x) => valueOf(x, 'Pokémon')), ['Charizard', 'Venusaur', 'Incineroar', 'Garchomp', 'Tauros-Paldea-Aqua', 'Sinistcha']);
    assert.equal(valueOf(b[0]!, 'Stat Alignment'), 'Timid');
    assert.equal(valueOf(b[0]!, 'Held Item'), 'Charizardite Y');
    assert.equal(valueOf(b[0]!, 'Ability'), 'Solar Power');
    assert.deepEqual([1, 2, 3, 4].map((i) => valueOf(b[0]!, `Move ${i}`)), ['Heat Wave', 'Solar Beam', 'Protect', 'Weather Ball']);
    assert.ok(p.includes('All Pokémon must be listed exactly as they appear in the Battle Team.'));
    assert.ok(p.includes('Pokémon Video Game Team List'));
  }
  // Page 1: stats from the EVs line (Stat Points), a stat it leaves out is 0.
  const first = boxes(p1)[0]!;
  assert.deepEqual(['HP', 'Atk', 'Def', 'Sp. Atk', 'Sp. Def', 'Speed'].map((l) => valueOf(first, l)), ['2', '0', '0', '32', '0', '32']);
  assert.equal(valueOf(boxes(p2)[0]!, 'Speed'), undefined, 'page 2 has no stats');
  assert.ok(p1.includes('1 of 2: For Tournament Staff') && p2.includes('2 of 2: For Opponents'));
});

test('a Mega prints as its base form, with the stone as its item; regional forms keep their name', () => {
  const mons = teamListMons(parseShowdown('Garchomp-Mega-Z @ Garchompite Z\n- Earthquake\n\nFloette-Mega @ Floettite\n\nTauros-Paldea-Blaze'));
  assert.deepEqual(mons.slice(0, 3).map((m) => [m?.pokemon, m?.heldItem]), [['Garchomp', 'Garchompite Z'], ['Floette-Eternal', 'Floettite'], ['Tauros-Paldea-Blaze', '']]);
});

test('missing item, ability, nature and moves print blank; a partial paste never throws', () => {
  const [p1] = pages(teamListPagesHTML(parseShowdown('Pikachu\n- Fake Out\n\nRaichu @ Focus Sash\nAbility: Lightning Rod'), DETAILS, ''));
  const b = boxes(p1);
  assert.equal(valueOf(b[0]!, 'Pokémon'), 'Pikachu');
  for (const l of ['Held Item', 'Ability', 'Stat Alignment', 'Move 2', 'Move 3', 'Move 4']) assert.equal(valueOf(b[0]!, l), '', l);
  assert.equal(valueOf(b[0]!, 'Move 1'), 'Fake Out');
  assert.equal(valueOf(b[0]!, 'HP'), '0', 'no EVs line: every stat is 0');
  assert.equal(valueOf(b[1]!, 'Ability'), 'Lightning Rod');
  // Boxes 3 to 6 are empty, stats included.
  for (const box of b.slice(2)) for (const l of ['Pokémon', 'Held Item', 'Move 1', 'HP', 'Speed']) assert.equal(valueOf(box, l), '', l);
  assert.doesNotThrow(() => teamListPagesHTML(parseShowdown('@@@\n\n - \n\nAbility: x'), emptyDetails(), ''));
});

test('an empty team prints two blank forms with six empty boxes each', () => {
  const [p1, p2] = pages(teamListPagesHTML([], emptyDetails(), ''));
  for (const p of [p1, p2]) {
    assert.equal(boxes(p).length, 6);
    assert.ok(boxes(p).every((x) => valueOf(x, 'Pokémon') === ''));
  }
  assert.ok(!p1.includes('tl-check on'), 'no age division ticked');
});

test('page 1 carries every player field; page 2 has no Player ID, Date of Birth or Support ID even when they are set', () => {
  const [p1, p2] = pages(teamListPagesHTML(parseShowdown(PASTE), DETAILS, 'Team 3 / Sun'));
  for (const v of ['Zed Q. Sampleperson', 'TrainerXq', '9876543', '07', '23', '1991', 'ProfileQz', 'SUPP9Q', 'Team 3 / Sun']) assert.ok(p1.includes(`>${esc(v)}<`), v);
  for (const l of ['Player Name:', 'Age Division:', 'Trainer Name in Game:', 'Player ID:', 'Battle Team Number / Name:', 'Date of Birth:', 'Switch Profile Name:', 'Support ID']) assert.ok(p1.includes(`>${l}<`), l);
  for (const v of ['Zed Q. Sampleperson', 'TrainerXq', 'ProfileQz', 'Team 3 / Sun']) assert.ok(p2.includes(`>${esc(v)}<`), v);
  for (const v of ['9876543', '1991', 'SUPP9Q', 'Player ID', 'Date of Birth', 'Support ID']) assert.ok(!p2.includes(v), `page 2 lacks ${v}`);
  // The chosen age division is ticked, on both pages.
  for (const p of [p1, p2]) assert.equal(p.match(/tl-check on/g)?.length, 1);
  assert.ok(p2.includes('aria-label="Masters (selected)"'));
});

test('player details are escaped on the pages', () => {
  const html = teamListPagesHTML([], { ...emptyDetails(), playerName: '<img src=x onerror=alert(1)>' }, '"><b>');
  assert.ok(!html.includes('<img') && !html.includes('"><b>'));
});

// ---- Privacy: the details live under their own key and never travel with the library ----

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

test('player details are saved under their own key, and Clear wipes it', () => {
  const storage = new MemoryStorage();
  const store = new PlayerDetailsStore(storage, config.storage.playerDetailsKey);
  assert.notEqual(config.storage.playerDetailsKey, config.storage.libraryKey);
  assert.notEqual(config.storage.playerDetailsKey, config.storage.prefsKey);
  store.save({ details: DETAILS, battleTeams: { t1: 'Sun Team' } });
  assert.deepEqual([...storage.data.keys()], [config.storage.playerDetailsKey]);
  assert.deepEqual(store.load(), { details: DETAILS, battleTeams: { t1: 'Sun Team' } });
  store.clear();
  assert.equal(storage.data.size, 0);
  assert.deepEqual(store.load(), emptyDetailsFile());
});

test('unreadable or hostile saved details read as empty, capped strings', () => {
  assert.deepEqual(readDetailsFile('nope'), emptyDetailsFile());
  const f = readDetailsFile({ details: { playerName: 'x'.repeat(500), ageDivision: 'Elders', playerId: 42, extra: 'kept?' }, battleTeams: { a: 'A', b: 7 } });
  assert.equal(f.details.playerName.length, 80);
  assert.equal(f.details.ageDivision, '');
  assert.equal(f.details.playerId, '');
  assert.ok(!('extra' in f.details));
  assert.deepEqual(f.battleTeams, { a: 'A' });
  const store = new PlayerDetailsStore(Object.assign(new MemoryStorage(), { getItem: () => '{broken' }), 'k');
  assert.deepEqual(store.load(), emptyDetailsFile());
});

test('the Battle Team line defaults to the team name and remembers the last value per team', () => {
  const file = emptyDetailsFile();
  assert.equal(battleTeamFor(file, 't1', 'Sun Team'), 'Sun Team');
  file.battleTeams.t1 = 'Team 4';
  assert.equal(battleTeamFor(file, 't1', 'Sun Team'), 'Team 4');
  file.battleTeams.t1 = '';
  assert.equal(battleTeamFor(file, 't1', 'Sun Team'), '', 'a cleared line stays cleared');
  assert.equal(battleTeamFor(file, 't2', 'Rain'), 'Rain');
});

test('saved player details never appear in an export, the stored library or the account-sync snapshot', () => {
  const storage = new MemoryStorage();
  const details = new PlayerDetailsStore(storage, config.storage.playerDetailsKey);
  const team = newTeam('Sun Team', PASTE);
  team.plans.push(newPlan('vs Rain', 'Pelipper\n- Hurricane'));
  details.save({ details: DETAILS, battleTeams: { [team.id]: 'Battle Team QQ-77' } });
  const lib: Library = { teams: [team] };
  const outputs = {
    'buildExport all': buildExport(lib, { type: 'all' }),
    'buildExport team': buildExport(lib, { type: 'team', teamId: team.id }),
    'buildExport plan': buildExport(lib, { type: 'plan', teamId: team.id, planId: team.plans[0]!.id }),
    writeLibrary: writeLibrary(lib),
    snapshotLibrary: snapshotLibrary(lib),
  };
  const secrets = [...Object.values(DETAILS).filter((v) => v && v !== 'Masters' && v.length > 2), 'Battle Team QQ-77'];
  for (const [name, out] of Object.entries(outputs)) {
    const text = JSON.stringify(out);
    for (const s of secrets) assert.ok(!text.includes(s), `${name} contains "${s}"`);
  }
});

// ---- Off by default: the team page's top bar is today's plus the one button ----

/** The team page's top bar exactly as it was rendered before this feature (main 4b886b1, src/ui/views/team-view.ts). */
const topbarBefore = (team: { id: string; name: string }, nav: string, ext: string): string => `<div class="topbar">${nav}<input class="title-input" id="team-name" value="${esc(team.name)}" aria-label="Team name">
    <span class="chip">${esc(REGULATION.label)}</span><span class="spacer"></span>
    <button class="btn" data-act="duplicate-team" data-team="${esc(team.id)}">Duplicate</button>
    <button class="btn" data-act="export-team" data-team="${esc(team.id)}">Export team</button>
    <button class="btn" data-act="copy-showdown" data-team="${esc(team.id)}" title="Copy this team as Showdown paste text, ready for Showdown's teambuilder">Copy Showdown paste</button>
    <button class="btn" data-act="download-showdown" data-team="${esc(team.id)}" title="Save this team as a Showdown paste (.txt)">Download .txt</button>
    <button class="btn danger" data-act="delete-team" data-team="${esc(team.id)}">Delete</button><div class="d-only">${ext}</div></div>`;

test('the team page top bar is byte-for-byte what it was, plus only the Official team list button', () => {
  for (const name of ['Sun Team', 'Quotes "&" <tags>', '']) {
    const team = newTeam(name, PASTE);
    const now = teamTopbarHTML(team, '<NAV/>', '<EXT/>');
    const button = teamListButton(team);
    assert.equal(now.split(button).length, 2, 'the button appears once');
    assert.equal(now.replace(`${button}\n    `, ''), topbarBefore(team, '<NAV/>', '<EXT/>'));
    assert.ok(button.includes('data-act="team-list"') && button.includes('>Official team list<'));
  }
});
