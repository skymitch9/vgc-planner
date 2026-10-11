/**
 * "Use a saved team…" above an opponent paste box: copies one of your saved teams into the box, so you can plan
 * against it. It is a copy; the gameplan doesn't follow later edits to that team.
 */
import { findTeam } from '../domain/model.ts';
import { opponentNameAfterPick, savedTeamChoices } from '../domain/saved-teams.ts';
import { store } from '../state/instance.ts';
import { esc } from './dom.ts';

/**
 * The picker for the paste box `targetSelector`; nothing when the library has no team to offer. `currentTeamId` is
 * the team the gameplan belongs to.
 */
export function savedTeamPicker(targetSelector: string, currentTeamId: string | null): string {
  const choices = savedTeamChoices(store.library, currentTeamId);
  if (!choices.length) return '';
  return `<div class="saved-team"><select class="input" data-saved-team data-target="${esc(targetSelector)}" aria-label="Use a saved team as the opponent">
    <option value="">Use a saved team…</option>${choices.map((c) => `<option value="${esc(c.id)}"${c.disabled ? ' disabled' : ''}>${esc(c.label)}</option>`).join('')}</select>
    <div class="hint">Copies the team as it is now. Later changes to the saved team don’t change this gameplan.</div></div>`;
}

/** True while the picker itself is writing into a paste box, to tell that from the user editing the box by hand. */
let filling = false;

function useSavedTeam(select: HTMLSelectElement): void {
  const team = findTeam(store.library, select.value);
  const box = select.dataset.target ? document.querySelector<HTMLTextAreaElement>(select.dataset.target) : null;
  if (!team || !box) return;
  box.value = team.paste;
  delete box.dataset.estimated;
  const nameField = box.dataset.nameField ? document.querySelector<HTMLInputElement>(box.dataset.nameField) : null;
  if (nameField) {
    // A name that is exactly a saved team's name came from an earlier pick (maybe in an earlier dialog): it follows.
    const typed = nameField.value.trim();
    const lastFilled = select.dataset.filledName ?? (store.library.teams.some((t) => t.name.trim() === typed) ? typed : undefined);
    nameField.value = opponentNameAfterPick(nameField.value, team.name, lastFilled);
    select.dataset.filledName = team.name;
  }
  filling = true;
  try { box.dispatchEvent(new Event('input', { bubbles: true })); } finally { filling = false; }
}

/** Wires every picker on the page, now and later: picking copies the team; editing the box by hand resets the picker. */
export function installSavedTeamPicker(): void {
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLSelectElement && 'savedTeam' in t.dataset && t.value) useSavedTeam(t);
  });
  document.addEventListener('input', (e) => {
    const box = e.target;
    if (filling || !(box instanceof HTMLTextAreaElement) || !box.id) return;
    document.querySelectorAll<HTMLSelectElement>('select[data-saved-team]').forEach((select) => {
      if (select.dataset.target === `#${box.id}`) select.value = '';
    });
  });
}
