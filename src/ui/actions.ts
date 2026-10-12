import { buildExport, DataError, LIMITS, mergeImport, readExport } from '../domain/codec.ts';
import type { ExportScope } from '../domain/codec.ts';
import { cleanSelections, setEstimated, clonePlan, cloneTab, cloneTeam, countNodes, findNode, findPlan, findTeam, monsFor, newNode, newPlan, newTab, newTeam, nextTabName, seedActions } from '../domain/model.ts';
import { copyNameFor } from '../domain/bulk-import.ts';
import { parseShowdown, teamWarnings } from '../domain/showdown.ts';
import { fileName, slug } from '../domain/strings.ts';
import { nextActions } from '../domain/simulation/state.ts';
import { showdownPaste, writeTeam } from '../domain/dex.ts';
import type { Side, SlotKind, Team } from '../domain/types.ts';
import { loadDex } from '../infra/dex-loader.ts';
import { store } from '../state/instance.ts';
import { requestRender } from './bus.ts';
import { esc, must } from './dom.ts';
import { monIcon } from './icons.ts';
import { formOf } from './names.ts';
import { savedTeamPicker } from './saved-teams.ts';
import { PASTE_LINK_HINT } from './paste-links.ts';
import { boxEstimates, estimatedToast, markBoxEstimates, openTopTeams, topTeamsButton } from './top-teams.ts';
import { confirmDialog, modal, openMenu, toast } from './overlays.ts';
import { turnResult } from './turn-results.ts';
import type { MenuItem } from './overlays.ts';
import { renderDrawer } from './views/drawer.ts';
import { renderTabBar, rerenderCanvas } from './views/plan-view.ts';

/* ------------------------------ teams & plans ------------------------------ */

export async function createTeam(): Promise<void> {
  const input = await modal<{ name: string; paste: string; estimated: string[] }>({
    title: 'New team', desc: `Paste your team in Showdown format, ${PASTE_LINK_HINT}.`,
    body: `<div><label class="lbl" for="nt-name">Team name</label><input class="field" id="nt-name" placeholder="e.g. Rain offense"></div>
           <div><label class="lbl" for="nt-paste">Showdown paste</label><textarea class="paste" id="nt-paste" data-team-paste data-name-field="#nt-name" placeholder="Rillaboom @ Assault Vest&#10;Ability: Grassy Surge&#10;- Fake Out&#10;- Grassy Glide&#10;&#10;…${PASTE_LINK_HINT}"></textarea>${topTeamsButton('#nt-paste')}</div>`,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Create team', cls: 'primary',
        run: (ov) => {
          const box = must<HTMLTextAreaElement>('#nt-paste', ov);
          return { name: must<HTMLInputElement>('#nt-name', ov).value.trim(), paste: box.value, estimated: boxEstimates(box) };
        },
      },
    ],
  });
  if (!input) return;
  const mons = parseShowdown(input.paste);
  const team = newTeam(input.name || (mons[0] ? `${mons[0].species} team` : 'My team'), input.paste);
  setEstimated(team, input.estimated);
  store.library.teams.push(team);
  Object.assign(store.ui, { teamId: team.id, planId: null });
  store.ui.open[team.id] = true;
  store.persist();
  requestRender();
  teamWarnings(mons).forEach((w) => toast(w, true));
}

export async function createPlan(teamId: string): Promise<void> {
  const team = findTeam(store.library, teamId);
  if (!team) return;
  const input = await modal<{ name: string; paste: string }>({
    title: 'New gameplan', desc: `Against which team? Gameplans are saved inside “${team.name}”.`,
    body: `<div><label class="lbl" for="np-name">Opponent team name (optional)</label><input class="field" id="np-name" placeholder="e.g. Sun balance from Regionals"></div>
           ${savedTeamPicker('#np-paste', team.id)}
           <div><label class="lbl" for="np-paste">Opponent Showdown paste (optional)</label><textarea class="paste" id="np-paste" data-team-paste data-name-field="#np-name" placeholder="Showdown paste, ${PASTE_LINK_HINT}"></textarea>${topTeamsButton('#np-paste')}</div>`,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Create gameplan', cls: 'primary', run: (ov) => ({ name: must<HTMLInputElement>('#np-name', ov).value.trim(), paste: must<HTMLTextAreaElement>('#np-paste', ov).value }) },
    ],
  });
  if (!input) return;
  createPlanFrom(team, input.name, input.paste);
}

/** A new gameplan in `team` against the opponent `paste` (named `name`, optional), opened straight away. */
export function createPlanFrom(team: Team, name: string, paste: string): void {
  const mons = parseShowdown(paste);
  const label = name || mons.slice(0, 2).map((m) => m.species).join(' / ');
  const plan = newPlan(label ? `vs ${label}` : 'New gameplan', paste);
  plan.opponent.name = name;
  team.plans.push(plan);
  Object.assign(store.ui, { teamId: team.id, planId: plan.id, tabId: null, selectedNode: null });
  store.ui.open[team.id] = true;
  store.persist();
  requestRender();
}

/**
 * "★ Top teams" under a paste box: the chosen team (with filled-in spreads) replaces the box's text and names an
 * empty name field; the box remembers which spreads were estimated, so saving it can label them.
 */
export async function pickTopTeam(target: string): Promise<void> {
  let dex;
  try { dex = await loadDex(); }
  catch { toast('Could not load the Pokémon data, so teams from a feed can’t be loaded right now. Reload the page and try again.', true); return; }
  openTopTeams(dex, [{
    label: 'Use this team', cls: 'primary',
    run: (sets, label, estimated) => {
      const box = document.querySelector<HTMLTextAreaElement>(target);
      if (!box) return;
      box.value = writeTeam(sets);
      markBoxEstimates(box, sets, estimated);
      const nameField = box.dataset.nameField ? document.querySelector<HTMLInputElement>(box.dataset.nameField) : null;
      if (nameField && !nameField.value.trim()) nameField.value = label;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
      if (estimated.length) toast(estimatedToast(estimated));
    },
  }]);
}

export async function editPaste(kind: Side): Promise<void> {
  const team = store.team; const plan = store.plan;
  if (!team || (kind === 'opp' && !plan)) return;
  const current = kind === 'opp' ? plan!.opponent.paste : team.paste;
  const input = await modal<{ paste: string; name: string; estimated: string[] }>({
    title: kind === 'opp' ? 'Opponent team' : 'Your team', desc: `Paste the team in Showdown format, ${PASTE_LINK_HINT}.`,
    body: (kind === 'opp' ? `<div><label class="lbl" for="ep-name">Team name (optional)</label><input class="field" id="ep-name" value="${esc(plan!.opponent.name)}"></div>${savedTeamPicker('#ep-paste', team.id)}` : '')
      + `<textarea class="paste tall" id="ep-paste" data-team-paste${kind === 'opp' ? ' data-name-field="#ep-name"' : ''} aria-label="Showdown paste">${esc(current)}</textarea>${topTeamsButton('#ep-paste')}`,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Save', cls: 'primary',
        run: (ov) => {
          const box = must<HTMLTextAreaElement>('#ep-paste', ov);
          return { paste: box.value, name: (ov.querySelector<HTMLInputElement>('#ep-name')?.value ?? '').trim(), estimated: boxEstimates(box) };
        },
      },
    ],
  });
  if (!input) return;
  const parsed = parseShowdown(input.paste);
  if (kind === 'opp' && plan) {
    plan.opponent.paste = input.paste;
    plan.opponent.name = input.name;
    cleanSelections([plan], 'opp', parsed);
  } else {
    if (input.paste !== team.paste) { team.paste = input.paste; setEstimated(team, input.estimated); }
    cleanSelections(team.plans, 'me', parsed);
  }
  store.persist();
  requestRender();
  teamWarnings(parsed).forEach((w) => toast(w, true));
}

export async function renameTeam(id: string): Promise<void> {
  const team = findTeam(store.library, id);
  if (!team) return;
  const name = await modal<string>({
    title: 'Rename team', body: `<input class="field" id="rn" aria-label="Team name" value="${esc(team.name)}">`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', run: (ov) => must<HTMLInputElement>('#rn', ov).value.trim() || team.name }],
  });
  if (name) { team.name = name; store.persist(); requestRender(); }
}

/** "Duplicate team": asks for the copy's name and whether its gameplans come along, then adds it right after the original. */
export async function duplicateTeam(id: string): Promise<void> {
  const team = findTeam(store.library, id);
  if (!team) return;
  const full = (): boolean => store.library.teams.length >= LIMITS.teams;
  const refuse = (): void => toast(`Your library already holds ${LIMITS.teams} teams, the most it can. Delete a team you no longer need, then duplicate this one.`, true);
  if (full()) { refuse(); return; }
  const suggested = copyNameFor(team.name, store.library.teams.map((t) => t.name));
  const n = team.plans.length;
  const input = await modal<{ name: string; withPlans: boolean }>({
    title: 'Duplicate team', desc: `A separate copy of “${team.name}” with the same Pokémon. Changing one never changes the other.`,
    body: `<div><label class="lbl" for="dt-name">Name of the copy</label><input class="field" id="dt-name" maxlength="${LIMITS.nameLength}" value="${esc(suggested)}"></div>`
      + (n ? `<label class="oc-check"><input type="checkbox" id="dt-plans">Copy its gameplans too (${n})</label>` : ''),
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Duplicate', cls: 'primary',
        run: (ov) => ({
          name: must<HTMLInputElement>('#dt-name', ov).value.trim().slice(0, LIMITS.nameLength) || suggested,
          withPlans: ov.querySelector<HTMLInputElement>('#dt-plans')?.checked === true,
        }),
      },
    ],
  });
  if (!input) return;
  // The library may have changed while the dialog was open (an account sync, another tab's import).
  if (full()) { refuse(); return; }
  const copy = cloneTeam(team, input);
  const { teams } = store.library;
  const at = teams.findIndex((t) => t.id === id);
  teams.splice(at < 0 ? teams.length : at + 1, 0, copy);
  Object.assign(store.ui, { teamId: copy.id, planId: null, tabId: null, selectedNode: null });
  store.ui.open[copy.id] = true;
  store.persist();
  requestRender();
  toast(`Duplicated ${team.name}`);
}

export async function deleteTeam(id: string): Promise<void> {
  const team = findTeam(store.library, id);
  if (!team) return;
  const n = team.plans.length;
  if (!await confirmDialog(`Delete “${team.name}”?`, `This also deletes its ${n} gameplan${n === 1 ? '' : 's'}. Export first if you want a backup.`)) return;
  store.library.teams = store.library.teams.filter((t) => t.id !== id);
  if (store.ui.teamId === id) Object.assign(store.ui, { teamId: null, planId: null, selectedNode: null });
  store.persist();
  requestRender();
}

export async function deletePlan(teamId: string, planId: string): Promise<void> {
  const team = findTeam(store.library, teamId);
  const plan = findPlan(team, planId);
  if (!team || !plan) return;
  if (!await confirmDialog(`Delete “${plan.name}”?`, 'The whole flowchart for this matchup will be removed.')) return;
  team.plans = team.plans.filter((p) => p.id !== planId);
  if (store.ui.planId === planId) Object.assign(store.ui, { planId: null, selectedNode: null });
  store.persist();
  requestRender();
}

export function duplicatePlan(teamId: string, planId: string): void {
  const team = findTeam(store.library, teamId);
  const plan = findPlan(team, planId);
  if (!team || !plan) return;
  const copy = clonePlan(plan);
  team.plans.push(copy);
  Object.assign(store.ui, { planId: copy.id, tabId: null, selectedNode: null });
  store.persist();
  requestRender();
}

/* ------------------------------ gameplan tabs ------------------------------ */

/** Opens a tab: the canvas starts at the top with no turn selected. */
export function selectTab(tabId: string): void {
  const plan = store.plan;
  if (!plan || !plan.tabs.some((t) => t.id === tabId) || store.tab?.id === tabId) return;
  Object.assign(store.ui, { tabId, selectedNode: null, scrollX: 0, scrollY: 0 });
  store.persist();
  requestRender();
}

/** A new, empty tab (pick its leads and backs), opened straight away with its name ready to edit. */
export function addTab(): void {
  const plan = store.plan;
  if (!plan) return;
  if (plan.tabs.length >= LIMITS.tabsPerPlan) { toast(`A gameplan can have up to ${LIMITS.tabsPerPlan} tabs.`, true); return; }
  const tab = newTab(nextTabName(plan));
  plan.tabs.push(tab);
  Object.assign(store.ui, { tabId: tab.id, selectedNode: null, scrollX: 0, scrollY: 0 });
  store.persist();
  requestRender();
  startRenameTab(tab.id);
}

export function duplicateTab(tabId: string): void {
  const plan = store.plan;
  const tab = plan?.tabs.find((t) => t.id === tabId);
  if (!plan || !tab) return;
  if (plan.tabs.length >= LIMITS.tabsPerPlan) { toast(`A gameplan can have up to ${LIMITS.tabsPerPlan} tabs.`, true); return; }
  const copy = cloneTab(tab, `${tab.name} (copy)`);
  plan.tabs.splice(plan.tabs.indexOf(tab) + 1, 0, copy);
  Object.assign(store.ui, { tabId: copy.id, selectedNode: null });
  store.persist();
  requestRender();
}

export async function deleteTab(tabId: string): Promise<void> {
  const plan = store.plan;
  const tab = plan?.tabs.find((t) => t.id === tabId);
  if (!plan || !tab) return;
  if (plan.tabs.length === 1) { toast('A gameplan needs at least one tab.', true); return; }
  const turns = countNodes(tab.children);
  if (turns && !await confirmDialog(`Delete the tab “${tab.name}”?`, `Its ${turns} turn${turns === 1 ? '' : 's'} will be deleted too.`)) return;
  const index = plan.tabs.indexOf(tab);
  plan.tabs.splice(index, 1);
  if (store.ui.tabId === tabId || !plan.tabs.some((t) => t.id === store.ui.tabId)) {
    Object.assign(store.ui, { tabId: plan.tabs[Math.max(0, index - 1)]!.id, selectedNode: null });
  }
  store.persist();
  requestRender();
}

/** Turns the tab's label into a text box, like renaming a spreadsheet sheet. Enter or leaving the box saves; Escape cancels. */
export function startRenameTab(tabId: string): void {
  const plan = store.plan;
  const tab = plan?.tabs.find((t) => t.id === tabId);
  const label = document.querySelector<HTMLElement>(`.sheet-tab[data-tab="${CSS.escape(tabId)}"] .nm`);
  if (!tab || !label) return;
  const input = document.createElement('input');
  input.className = 'tab-rename';
  input.value = tab.name;
  input.maxLength = LIMITS.nameLength;
  input.setAttribute('aria-label', 'Tab name');
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== tab.name) { tab.name = name; store.persist(); }
    renderTabBar();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

export function tabMenu(anchor: HTMLElement, tabId: string): void {
  const plan = store.plan;
  if (!plan) return;
  const items: MenuItem[] = [
    { label: 'Rename', run: () => startRenameTab(tabId) },
    { label: 'Duplicate', run: () => duplicateTab(tabId) },
  ];
  if (plan.tabs.length > 1) items.push('-', { label: 'Delete', cls: 'danger', run: () => void deleteTab(tabId) });
  openMenu(anchor, items);
}

/* ------------------------------ export / import ------------------------------ */

export async function showExport(scope: ExportScope): Promise<void> {
  let json: string;
  try { json = JSON.stringify(buildExport(store.library, scope), null, 2); }
  catch (e) { toast(e instanceof DataError ? e.message : 'Nothing to export.', true); return; }
  const team = scope.type === 'all' ? undefined : findTeam(store.library, scope.teamId);
  const filename = scope.type === 'all'
    ? 'vgc-gameplans-all'
    : slug(`${team?.name ?? 'team'}${scope.type === 'plan' ? `-${findPlan(team, scope.planId)?.name ?? 'plan'}` : ''}`);

  await modal<null>({
    title: 'Export JSON', desc: 'Import this file in the tool to restore the teams and gameplans.',
    body: `<textarea class="paste medium" readonly id="exp" aria-label="Exported JSON">${esc(json)}</textarea>`,
    actions: [
      { label: 'Close', value: null },
      ...(scope.type === 'team' ? [{
        label: 'Showdown paste',
        run: () => { setTimeout(() => void showShowdownExport(scope.teamId), 0); return null; },
      }] : []),
      {
        label: 'Copy',
        run: () => {
          must<HTMLTextAreaElement>('#exp').select();
          void navigator.clipboard.writeText(json).then(() => toast('Copied to clipboard'), () => toast('Copy failed. Select the text and copy it manually.', true));
          return false;
        },
      },
      {
        label: 'Download .json', cls: 'primary',
        run: () => {
          downloadText(json, `${filename}.json`, 'application/json');
          return false;
        },
      },
    ],
  });
}

/** Saves text as a file through a temporary link (no inline handlers, so the CSP stays strict). */
function downloadText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${name}`);
}

/** The team as Showdown export text, or null (with a toast) when the team has no Pokémon yet. */
function teamShowdown(teamId: string): { team: Team; text: string } | null {
  const team = findTeam(store.library, teamId);
  if (!team) return null;
  const text = showdownPaste(team.paste);
  if (!text) { toast('This team has no Pokémon yet', true); return null; }
  return { team, text };
}

/** Copies the team as a Showdown paste; if the clipboard refuses, opens the dialog with the text selected. */
export function copyShowdownPaste(teamId: string): void {
  const found = teamShowdown(teamId);
  if (!found) return;
  const fallback = (): void => { void showShowdownExport(teamId, 'Copy failed. The text is selected: press Ctrl+C (Cmd+C) to copy it.'); };
  if (!navigator.clipboard) { fallback(); return; }
  navigator.clipboard.writeText(found.text).then(() => toast('Showdown paste copied'), fallback);
}

/** Downloads the team as a Showdown paste, named after the team. */
export function downloadShowdownPaste(teamId: string): void {
  const found = teamShowdown(teamId);
  if (found) downloadText(found.text, `${fileName(found.team.name)}.txt`, 'text/plain');
}

/** The team as Showdown paste text in a dialog, ready to copy into Showdown's teambuilder (Import from text). */
export async function showShowdownExport(teamId: string, problem?: string): Promise<void> {
  const found = teamShowdown(teamId);
  if (!found) return;
  const { team, text } = found;
  const opened = modal<null>({
    title: 'Showdown paste',
    desc: problem ?? "Paste this into Showdown's teambuilder (New team, then Import from text).",
    body: `<textarea class="paste medium" readonly id="exp-sd" aria-label="Showdown paste">${esc(text)}</textarea>`,
    actions: [
      { label: 'Close', value: null },
      {
        label: 'Copy',
        run: () => {
          must<HTMLTextAreaElement>('#exp-sd').select();
          void navigator.clipboard.writeText(text).then(() => toast('Showdown paste copied'), () => toast('Copy failed. Select the text and copy it manually.', true));
          return false;
        },
      },
      {
        label: 'Download .txt', cls: 'primary',
        run: () => { downloadText(text, `${fileName(team.name)}.txt`, 'text/plain'); return false; },
      },
    ],
  });
  must<HTMLTextAreaElement>('#exp-sd').select();
  await opened;
}

/** Merges this app's export file (as JSON text) into the library and returns the summary line; throws DataError on a bad file. The Import dialog (bulk-import.ts) calls it. */
export function importText(text: string): string {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { throw new DataError(`That text isn't valid JSON: ${e instanceof Error ? e.message : ''}`); }
  const summary = mergeImport(store.library, readExport(raw));
  if (summary.focus) {
    Object.assign(store.ui, { teamId: summary.focus.teamId, planId: summary.focus.planId, tabId: null, selectedNode: null });
    store.ui.open[summary.focus.teamId] = true;
  }
  store.persist();
  const t = summary.newTeams; const p = summary.plans;
  return `Imported ${t} new team${t === 1 ? '' : 's'} and ${p} gameplan${p === 1 ? '' : 's'}${summary.regulationWarning ? ` (${summary.regulationWarning})` : ''}.`;
}

/* ------------------------------ flowchart ------------------------------ */

export function pickSlot(anchor: HTMLElement, side: Side, kind: SlotKind, index: number): void {
  const team = store.team; const plan = store.sheet;
  if (!team || !plan) return;
  const mons = monsFor(side, team, plan).map((m) => m.species);
  if (!mons.length) { toast(side === 'me' ? "Add your team's paste first." : 'Paste the opponent team first.', true); return; }
  const sel = plan.selection[side];
  const used = new Set([...sel.lead, ...sel.back].filter((n): n is string => !!n));
  const set = (value: string | null): void => { sel[kind][index] = value; store.persist(); rerenderCanvas(); };
  const items: MenuItem[] = mons
    .filter((m) => !used.has(m) || sel[kind][index] === m)
    .map((m) => ({ html: `${monIcon(formOf(null, side, m), 'xs')}<span>${esc(formOf(null, side, m))}</span>`, run: () => set(m) }));
  if (sel[kind][index]) items.push('-', { label: 'Clear slot', run: () => set(null) });
  openMenu(anchor, items);
}

export function addNode(parentId: string | null): void {
  const plan = store.sheet;
  if (!plan) return;
  const parent = parentId ? findNode(plan.children, parentId) : null;
  const before = turnResult(parent?.node.id);
  if (before?.status === 'ready' && before.outcome) { toast('The battle is over in this branch, so no more turns can follow it.', true); return; }
  // Follow the simulated battle when we can (who is on the field, who needs replacing); otherwise repeat the parent's Pokémon.
  const actions = before?.status === 'ready' ? nextActions(before.state) : seedActions(parent?.node ?? null, plan);
  const node = newNode({ actions });
  (parent ? parent.node.children : plan.children).push(node);
  store.ui.selectedNode = node.id;
  store.persist();
  rerenderCanvas();
  renderDrawer();
}

export async function deleteNode(): Promise<void> {
  const found = store.currentNode();
  if (!found) return;
  const followUps = countNodes([found.node]) - 1;
  if (followUps > 0 && !await confirmDialog('Delete this turn?', `It has ${followUps} follow-up turn${followUps === 1 ? '' : 's'} that will be deleted too.`)) return;
  found.siblings.splice(found.siblings.indexOf(found.node), 1);
  store.ui.selectedNode = null;
  store.persist();
  must('#drawer').classList.add('hidden');
  rerenderCanvas();
}
