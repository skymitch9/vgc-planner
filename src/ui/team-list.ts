/**
 * "Official team list": a dialog opened from the team page that fills in the two-page tournament team list from the
 * team's paste and the player's details, previews both pages and prints them (the print dialog's "Save as PDF" gives
 * the two-page PDF). Only the two pages print: `styles/team-list.css`.
 *
 * The details are saved in this browser only, under their own key (infra/player-details.ts).
 */
import { config } from '../config.ts';
import { findTeam } from '../domain/model.ts';
import { parseShowdown } from '../domain/showdown.ts';
import type { PlayerDetails, PlayerDetailsFile } from '../domain/team-list.ts';
import { AGE_DIVISIONS, battleTeamFor, emptyDetailsFile } from '../domain/team-list.ts';
import { PlayerDetailsStore } from '../infra/player-details.ts';
import { usableLocalStorage } from '../infra/repository.ts';
import { store } from '../state/instance.ts';
import { esc } from './dom.ts';
import { toast } from './overlays.ts';
import { teamListPagesHTML } from './team-list-pages.ts';

/** Paper width of the on-screen preview (8.5 in at 96 px per inch); the preview is scaled down to fit. */
const SHEET_PX = 816;

type TextKey = Exclude<keyof PlayerDetails, 'ageDivision'>;

export function openTeamList(teamId: string): void {
  const team = findTeam(store.library, teamId);
  if (!team) return;
  const details = new PlayerDetailsStore(usableLocalStorage(), config.storage.playerDetailsKey);
  let file: PlayerDetailsFile = details.load();
  let battleTeam = battleTeamFor(file, team.id, team.name);
  const sets = parseShowdown(team.paste);

  const input = (key: TextKey, label: string): string =>
    `<label class="tl-in"><span class="lbl">${esc(label)}</span><input class="input" data-k="${key}" value="${esc(file.details[key])}" maxlength="80" autocomplete="off"></label>`;
  const dob = (key: TextKey, label: string, placeholder: string, max: number): string =>
    `<input class="input tl-dob-in" data-k="${key}" value="${esc(file.details[key])}" placeholder="${placeholder}" maxlength="${max}" inputmode="numeric" aria-label="${esc(label)}">`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide tl-modal" role="dialog" aria-modal="true" aria-label="Official team list">
    <div class="modal-head"><h2>Official team list · ${esc(team.name)}</h2>
      <p>The two-page Pokémon Video Game Team List for in-person tournaments, filled in from this team. Print it, or choose "Save as PDF" in the print dialog.</p></div>
    <div class="modal-body">
      <fieldset class="tl-form"><legend>Player details</legend>
        <div class="tl-grid">
          ${input('playerName', 'Player Name')}
          <div class="tl-in" role="radiogroup" aria-label="Age Division"><span class="lbl">Age Division</span><span class="tl-radios">${AGE_DIVISIONS.map((a) =>
            `<label><input type="radio" name="tl-age" value="${a}"${file.details.ageDivision === a ? ' checked' : ''}> ${a}</label>`).join('')}</span></div>
          ${input('trainerName', 'Trainer Name in Game')}
          ${input('playerId', 'Player ID')}
          <div class="tl-in"><span class="lbl">Date of Birth</span><span class="tl-dob-row">${dob('dobMonth', 'Month of birth', 'MM', 2)}/${dob('dobDay', 'Day of birth', 'DD', 2)}/${dob('dobYear', 'Year of birth', 'YYYY', 4)}</span></div>
          ${input('switchProfile', 'Switch Profile Name')}
          ${input('supportId', 'Support ID')}
        </div>
        <div class="tl-store"><span class="hint">Stored only in this browser: never exported, shared or synced to an account.</span><button class="btn sm ghost danger" id="tl-clear">Clear</button></div>
      </fieldset>
      <label class="tl-in"><span class="lbl">Battle Team Number / Name</span><input class="input" id="tl-battle-team" value="${esc(battleTeam)}" maxlength="80" autocomplete="off"></label>
      <div class="tl-preview" id="tl-preview" aria-label="Preview of both pages"></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="tl-print">Print</button><button class="btn" id="tl-close">Close</button></div></div>`;

  // What prints: a copy of the two pages outside the dialog; everything else on the page is hidden while printing.
  const printRoot = document.createElement('div');
  printRoot.id = 'tl-print-root';
  document.body.append(overlay, printRoot);
  document.body.classList.add('tl-printing');
  const preview = overlay.querySelector<HTMLElement>('#tl-preview')!;

  const fit = (): void => {
    const scale = Math.min(1, (preview.clientWidth - 2) / SHEET_PX);
    preview.querySelectorAll<HTMLElement>('.tl-sheet').forEach((el) => { el.style.zoom = String(scale > 0 ? scale : 1); });
  };
  const draw = (): void => {
    const html = teamListPagesHTML(sets, file.details, battleTeam);
    printRoot.innerHTML = html;
    preview.innerHTML = html.replace(/<section class="tl-page">/g, '<div class="tl-sheet"><section class="tl-page">').replace(/<\/section>/g, '</section></div>');
    fit();
  };
  const persist = (): void => { details.save(file); };

  overlay.querySelectorAll<HTMLInputElement>('[data-k]').forEach((el) => el.addEventListener('input', () => {
    file.details[el.dataset.k as TextKey] = el.value;
    persist();
    draw();
  }));
  overlay.querySelectorAll<HTMLInputElement>('input[name="tl-age"]').forEach((el) => el.addEventListener('change', () => {
    if (el.checked) file.details.ageDivision = el.value as PlayerDetails['ageDivision'];
    persist();
    draw();
  }));
  overlay.querySelector<HTMLInputElement>('#tl-battle-team')!.addEventListener('input', (e) => {
    battleTeam = (e.target as HTMLInputElement).value;
    file.battleTeams[team.id] = battleTeam;
    persist();
    draw();
  });
  overlay.querySelector('#tl-clear')!.addEventListener('click', () => {
    details.clear();
    file = emptyDetailsFile();
    battleTeam = battleTeamFor(file, team.id, team.name);
    overlay.querySelectorAll<HTMLInputElement>('[data-k]').forEach((el) => { el.value = ''; });
    overlay.querySelectorAll<HTMLInputElement>('input[name="tl-age"]').forEach((el) => { el.checked = false; });
    overlay.querySelector<HTMLInputElement>('#tl-battle-team')!.value = battleTeam;
    draw();
    toast('Player details cleared from this browser');
  });
  overlay.querySelector('#tl-print')!.addEventListener('click', () => window.print());

  const close = (): void => {
    overlay.remove();
    printRoot.remove();
    document.body.classList.remove('tl-printing');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', fit);
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fit);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#tl-close')!.addEventListener('click', close);
  if (!details.persistent) toast('This browser blocks storage: the details will not be kept after you close the dialog.', true);
  draw();
}
