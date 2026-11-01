/**
 * The two pages of the official Pokémon Video Game Team List as HTML, drawn to the form's fields, order and wording:
 * page 1 for tournament staff (with Player ID, Date of Birth, Support ID and each Pokémon's Stat Points), page 2 for
 * opponents (none of those). Pure: no DOM, so it is tested directly. Styles: `styles/team-list.css`.
 */
import type { PlayerDetails, TeamListMon } from '../domain/team-list.ts';
import { AGE_DIVISIONS, teamListMons } from '../domain/team-list.ts';
import type { PokemonSet, StatKey } from '../domain/types.ts';
import { esc } from './dom.ts';

const TITLE = 'Pokémon Video Game Team List';
const FOOTER = 'All Pokémon must be listed exactly as they appear in the Battle Team.';
const STAT_ROWS: readonly [StatKey, string][] = [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spa', 'Sp. Atk'], ['spd', 'Sp. Def'], ['spe', 'Speed']];

const field = (label: string, value: string): string =>
  `<div class="tl-field"><span class="tl-label">${esc(label)}</span><span class="tl-value">${esc(value)}</span></div>`;

const ageField = (d: PlayerDetails): string =>
  `<div class="tl-field"><span class="tl-label">Age Division:</span><span class="tl-checks">${AGE_DIVISIONS.map((a) =>
    `<span class="tl-check-item"><span class="tl-check${d.ageDivision === a ? ' on' : ''}" aria-label="${esc(a)}${d.ageDivision === a ? ' (selected)' : ''}">${d.ageDivision === a ? 'X' : ''}</span>${esc(a)}</span>`).join('')}</span></div>`;

const dobField = (d: PlayerDetails): string =>
  `<div class="tl-field"><span class="tl-label">Date of Birth:</span><span class="tl-dob"><span class="tl-value">${esc(d.dobMonth)}</span>/<span class="tl-value">${esc(d.dobDay)}</span>/<span class="tl-value">${esc(d.dobYear)}</span></span></div>`;

function monBox(m: TeamListMon | null, withStats: boolean): string {
  const rows: [string, string][] = [
    ['Pokémon', m?.pokemon ?? ''], ['Stat Alignment', m?.statAlignment ?? ''], ['Ability', m?.ability ?? ''], ['Held Item', m?.heldItem ?? ''],
    ...[0, 1, 2, 3].map((i): [string, string] => [`Move ${i + 1}`, m?.moves[i] ?? '']),
  ];
  const info = `<div class="tl-mon-info">${rows.map(([label, value], i) =>
    `<div class="tl-row${i === 0 ? ' tl-name' : ''}"><span class="tl-label">${esc(label)}</span><span class="tl-value">${esc(value)}</span></div>`).join('')}</div>`;
  const stats = withStats
    ? `<div class="tl-mon-stats">${STAT_ROWS.map(([k, label]) =>
      `<div class="tl-row"><span class="tl-label">${esc(label)}</span><span class="tl-value">${m ? m.stats[k] : ''}</span></div>`).join('')}</div>`
    : '';
  return `<div class="tl-mon${withStats ? ' with-stats' : ''}">${info}${stats}</div>`;
}

function page(subtitle: string, instruction: string, player: string, mons: (TeamListMon | null)[], withStats: boolean): string {
  return `<section class="tl-page">
  <header class="tl-head"><h1 class="tl-title">${esc(TITLE)}</h1><div class="tl-subtitle">${esc(subtitle)}</div><p class="tl-instruction">${esc(instruction)}</p></header>
  <div class="tl-player">${player}</div>
  <div class="tl-mons">${mons.map((m) => monBox(m, withStats)).join('')}</div>
  <footer class="tl-foot">${esc(FOOTER)}</footer>
</section>`;
}

/**
 * Both pages, filled in. `battleTeam` is the Battle Team Number / Name line. Fewer than six Pokémon leave the
 * remaining boxes empty; a partial paste prints what it has.
 */
export function teamListPagesHTML(sets: readonly PokemonSet[], details: PlayerDetails, battleTeam: string): string {
  const mons = teamListMons(sets);
  const d = details;
  const staff = [
    field('Player Name:', d.playerName), ageField(d),
    field('Trainer Name in Game:', d.trainerName), field('Player ID:', d.playerId),
    field('Battle Team Number / Name:', battleTeam), dobField(d),
    field('Switch Profile Name:', d.switchProfile), field('Support ID', d.supportId),
  ].join('');
  const opponents = [
    field('Player Name:', d.playerName), ageField(d),
    field('Trainer Name in Game:', d.trainerName), field('Battle Team Number / Name:', battleTeam),
    field('Switch Profile Name:', d.switchProfile),
  ].join('');
  return page('1 of 2: For Tournament Staff', 'Complete both pages of this document. Submit this page to event staff before the tournament, at the time set by the Organizer.', staff, mons, true)
    + page('2 of 2: For Opponents', 'Do not lose this page! Keep it throughout the tournament, sharing it with your opponent each round.', opponents, mons, false);
}
