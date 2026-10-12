/**
 * The Import dialog, with two tabs over one text box:
 * - "Teams from pastes": many teams at once, from Showdown pastes, teambuilder backups and pokepast.es / vrpastes.com
 *   links (see domain/bulk-import.ts). Preview lists what was found; nothing is created before Import is pressed.
 * - "Backup file (JSON)": this app's own export file (chosen, pasted, or fetched from a URL), merged into the library
 *   by team name.
 * Text that is a backup file switches to the second tab by itself.
 */
import { config } from '../config.ts';
import { BULK_MAX_ITEMS, capBulk, looksLikeBackup, nameFor, splitBulk, teamKey } from '../domain/bulk-import.ts';
import type { BulkPaste } from '../domain/bulk-import.ts';
import { DataError, LIMITS } from '../domain/codec.ts';
import { setProblems, teamProblems, writeTeam } from '../domain/dex.ts';
import type { Dex } from '../domain/dex.ts';
import { newTeam, setEstimated } from '../domain/model.ts';
import { PASTE_SITE_LABEL, parsePasteLink } from '../domain/paste-links.ts';
import { REGULATION } from '../domain/regulation.ts';
import { parseShowdown, teamWarnings } from '../domain/showdown.ts';
import { fillSpreads } from '../domain/team-feed.ts';
import type { PokemonSet } from '../domain/types.ts';
import { checkBackupUrl, fetchBackup } from '../infra/backup-url.ts';
import { loadDex } from '../infra/dex-loader.ts';
import { fetchPasteLink } from '../infra/paste-links.ts';
import { store } from '../state/instance.ts';
import { importText } from './actions.ts';
import { requestRender } from './bus.ts';
import { esc, must } from './dom.ts';
import { monIcon } from './icons.ts';
import { toast } from './overlays.ts';

export type ImportTab = 'pastes' | 'backup';

const TABS: ReadonlyArray<[ImportTab, string]> = [['pastes', 'Teams from pastes'], ['backup', 'Backup file (JSON)']];
const DESC: Readonly<Record<ImportTab, string>> = {
  pastes: 'Add several teams at once. Press Preview to see what was found; nothing is added before you press Import.',
  backup: 'Choose a file, paste the JSON or fetch it from a URL. Teams with the same name are merged, so gameplans land in the right folder.',
};
const PLACEHOLDER: Readonly<Record<ImportTab, string>> = {
  pastes: 'Showdown pastes, with a line of --- between teams\npokepast.es / vrpastes.com links, one per line\nor a Showdown teambuilder backup (=== [format] Team name ===)',
  backup: 'Paste JSON here',
};
const MAX_FILE_BYTES = config.backupUrl.maxBytes;

/** One line of the preview: a team that can be imported, or something that could not be read (with why, in words). */
type Row =
  | { ok: true; name: string; sets: PokemonSet[]; paste: string; checked: boolean; problems: string[]; partial: boolean; dupOf: string }
  | { ok: false; source: string; error: string };
type TeamRow = Extract<Row, { ok: true }>;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function rowHTML(row: Row, index: number): string {
  if (!row.ok) {
    return `<div class="imp-row err" data-row="${index}"><span class="imp-src" title="${esc(row.source)}">${esc(row.source)}</span><span class="err-text">${esc(row.error)}</span></div>`;
  }
  const badges = [
    row.dupOf ? `<span class="tt-badge part">duplicate of ${esc(row.dupOf)}</span>` : '',
    row.partial ? `<span class="tt-badge est" title="${esc(`A team has ${REGULATION.teamSize} Pokémon; this one has ${row.sets.length}`)}">partial team</span>` : '',
  ].join('');
  const problems = row.problems.length
    ? `<details class="imp-problems"><summary>${esc(plural(row.problems.length, 'rule problem'))}</summary>${row.problems.map((p) => `<div>${esc(p)}</div>`).join('')}</details>`
    : '';
  return `<div class="imp-row${row.checked ? '' : ' off'}" data-row="${index}">
    <input type="checkbox" class="imp-on" aria-label="Import this team"${row.checked ? ' checked' : ''}>
    <input class="field imp-name" aria-label="Team name" maxlength="${LIMITS.nameLength}" value="${esc(row.name)}">
    <span class="imp-mons">${row.sets.map((s) => monIcon(s.species, 'sm')).join('')}</span>
    <span class="tt-badges">${badges}</span>${problems}</div>`;
}

/** Opens the dialog on `tab`; with `url`, on the Backup tab with that address filled in and its fetch started. */
export function openImport(tab: ImportTab = 'pastes', { url }: { url?: string } = {}): void {
  if (url) tab = 'backup';
  let rows: Row[] = [];
  let dex: Dex | null = null;
  let busy = false;
  let previewToken = 0;
  let fetchToken = 0;
  /** The address the box's text was fetched from (remembered once it is imported); null once the text changes. */
  let fetchedFrom: string | null = null;
  /** Teams already downloaded in this dialog, so pressing Preview again doesn't fetch them twice. */
  const fetched = new Map<string, ReturnType<typeof fetchPasteLink>>();

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide imp-modal" role="dialog" aria-modal="true" aria-label="Import">
    <div class="modal-head"><h2>Import</h2>
      <div class="seg mt-s" role="tablist" aria-label="What to import">${TABS.map(([t, l]) => `<button type="button" class="seg-btn" role="tab" data-tab="${t}">${esc(l)}</button>`).join('')}</div>
      <p id="imp-desc"></p></div>
    <div class="modal-body">
      <textarea class="paste medium" id="imp-text" spellcheck="false"></textarea>
      <div class="imp-controls">
        <input type="file" id="imp-file" accept=".txt,.json,text/plain,application/json">
        <label class="tt-check" id="imp-fill-wrap"><input type="checkbox" id="imp-fill" checked> Fill missing spreads from usage (marked Estimated)</label>
        <button type="button" class="btn sm" id="imp-preview" title="Ctrl+Enter">Preview</button>
      </div>
      <div class="imp-url" id="imp-url-wrap">
        <label class="lbl" for="imp-url">…or fetch from a URL</label>
        <div class="imp-url-row"><input type="url" class="field" id="imp-url" placeholder="https://example.com/backup.json" spellcheck="false" autocomplete="url"><button type="button" class="btn sm" id="imp-fetch">Fetch</button></div>
      </div>
      <div class="hint" id="imp-status" role="status"></div>
      <div class="hint err-text" id="imp-err" role="alert"></div>
      <div class="imp-rows" id="imp-rows"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" id="imp-cancel">Cancel</button><button type="button" class="btn primary" id="imp-go">Import</button></div></div>`;
  const $ = <T extends HTMLElement>(sel: string): T => must<T>(sel, overlay);
  const box = $<HTMLTextAreaElement>('#imp-text');
  const file = $<HTMLInputElement>('#imp-file');
  const fill = $<HTMLInputElement>('#imp-fill');
  const previewBtn = $<HTMLButtonElement>('#imp-preview');
  const urlField = $<HTMLInputElement>('#imp-url');
  const fetchBtn = $<HTMLButtonElement>('#imp-fetch');
  const go = $<HTMLButtonElement>('#imp-go');
  const status = $('#imp-status');
  const error = $('#imp-err');
  const list = $('#imp-rows');

  const teamRows = (): TeamRow[] => rows.filter((r): r is TeamRow => r.ok);
  const chosen = (): TeamRow[] => teamRows().filter((r) => r.checked);

  const drawFoot = (): void => {
    if (tab === 'backup') { go.textContent = 'Import'; go.disabled = busy; return; }
    const n = chosen().length;
    go.textContent = `Import ${plural(n, 'team')}`;
    go.disabled = busy || n === 0;
  };

  const drawRows = (): void => {
    list.innerHTML = tab === 'pastes' ? rows.map(rowHTML).join('') : '';
    drawFoot();
  };

  const setTab = (next: ImportTab): void => {
    tab = next;
    overlay.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('#imp-desc').textContent = DESC[tab];
    box.placeholder = PLACEHOLDER[tab];
    box.setAttribute('aria-label', tab === 'pastes' ? 'Team pastes and links' : 'JSON text');
    file.setAttribute('aria-label', tab === 'pastes' ? 'Text file with teams' : 'JSON file');
    $('#imp-fill-wrap').hidden = tab !== 'pastes';
    previewBtn.hidden = tab !== 'pastes';
    $('#imp-url-wrap').hidden = tab !== 'backup';
    status.textContent = '';
    error.textContent = '';
    drawRows();
  };

  /** The text changed (typed, pasted or loaded from a file): a preview of the old text no longer stands. */
  const textChanged = (): void => {
    previewToken++;
    fetchedFrom = null;
    error.textContent = '';
    const hadPreview = rows.length > 0;
    rows = [];
    if (looksLikeBackup(box.value)) {
      if (tab !== 'backup') setTab('backup');
      status.textContent = 'This is a backup file from this app, so it will be imported as one: teams and gameplans, merged by team name.';
      return;
    }
    status.textContent = hadPreview ? 'The text changed. Press Preview again.' : '';
    drawRows();
  };

  const setBusy = (on: boolean): void => {
    busy = on;
    previewBtn.disabled = on;
    fetchBtn.disabled = on;
    drawFoot();
  };

  const preview = async (): Promise<void> => {
    if (tab !== 'pastes' || busy) return;
    const token = ++previewToken;
    const stale = (): boolean => token !== previewToken || !overlay.isConnected;
    error.textContent = '';
    status.textContent = '';
    rows = [];
    drawRows();
    const found = splitBulk(box.value);
    if (!found.length) { error.textContent = box.value.trim() ? 'No Pokémon or team links were found in that text.' : 'Paste some teams or links, or choose a file, first.'; return; }
    const { items, dropped, reason } = capBulk(found, store.library.teams.length);
    if (!items.length) { error.textContent = `The library is full (${LIMITS.teams} teams). Delete a team to make room.`; return; }

    setBusy(true);
    try {
      status.textContent = 'Loading the Pokémon data…';
      try { dex = await loadDex(); } catch { dex = null; }
      if (stale()) return;

      // Teams already in the library, by content, so that importing the same text twice is noticed. A team whose
      // spreads were filled from usage on the way in is recognised by what it looks like once filled.
      const known = new Map<string, string>();
      for (const t of store.library.teams) {
        const key = teamKey(parseShowdown(t.paste));
        if (key && !known.has(key)) known.set(key, t.name);
      }
      const names = store.library.teams.map((t) => t.name);
      const next: Row[] = [];
      const addTeam = (item: BulkPaste, hint: string | undefined): void => {
        const sets = parseShowdown(item.paste);
        const keys = [teamKey(sets), ...(dex ? [teamKey(fillSpreads(sets, dex).sets)] : [])];
        const dupOf = keys.map((k) => known.get(k)).find((n) => n !== undefined) ?? '';
        const name = nameFor(sets, hint, names);
        names.push(name);
        for (const k of keys) if (!known.has(k)) known.set(k, `${name} (in this list)`);
        next.push({
          ok: true, name, sets, paste: item.paste, dupOf, checked: !dupOf,
          partial: sets.length < REGULATION.teamSize,
          problems: dex ? [...teamProblems(sets, dex), ...sets.flatMap((s) => setProblems(s, dex!))] : teamWarnings(sets),
        });
      };

      const linkCount = items.filter((i) => i.kind === 'link').length;
      let linkIndex = 0;
      // One link at a time, in order: the paste sites are someone else's servers.
      for (const item of items) {
        if (item.kind === 'paste') { addTeam(item, item.name); continue; }
        if (item.kind === 'badlink') {
          next.push({ ok: false, source: item.url, error: 'This isn’t a pokepast.es or vrpastes.com team link, so it can’t be loaded. Paste the team’s text instead.' });
          continue;
        }
        linkIndex++;
        status.textContent = `Loading ${linkIndex} of ${linkCount}…`;
        const link = parsePasteLink(item.url);
        if (!link) continue;
        try {
          let job = fetched.get(link.api);
          if (!job) { job = fetchPasteLink(link); fetched.set(link.api, job); }
          const { paste, title } = await job;
          if (stale()) return;
          const teams = splitBulk(paste).filter((i): i is BulkPaste => i.kind === 'paste');
          if (!teams.length) next.push({ ok: false, source: item.url, error: `That ${PASTE_SITE_LABEL[link.site]} link has no Pokémon in it.` });
          for (const t of teams) addTeam(t, title || t.name);
        } catch (e) {
          fetched.delete(link.api);
          if (stale()) return;
          const message = e instanceof Error ? e.message : String(e);
          // A link that doesn't exist fails the same way as no connection (the sites send no CORS headers on a 404).
          next.push({ ok: false, source: item.url, error: /^Couldn.t reach/.test(message) ? `${PASTE_SITE_LABEL[link.site]} didn’t answer for this link: either there is no team at that address, or the site can’t be reached right now.` : message });
        }
      }

      rows = next;
      const teams = teamRows().length;
      const failed = rows.length - teams;
      const notes = [`${plural(teams, 'team')} found`];
      if (failed) notes.push(`${plural(failed, 'link')} could not be loaded`);
      let text = `${notes.join(', ')}.`;
      if (dropped) {
        text += reason === 'library'
          ? ` ${plural(dropped, 'more team')} left out: the library holds ${LIMITS.teams} teams.`
          : ` ${plural(dropped, 'more team')} left out: one import takes ${BULK_MAX_ITEMS} at most, so import the rest afterwards.`;
      }
      if (!dex) text += ' The Pokémon data could not be loaded, so the rules aren’t checked and spreads won’t be filled.';
      status.textContent = text;
      drawRows();
    } finally {
      if (overlay.isConnected) setBusy(false);
    }
  };

  const importTeams = (): void => {
    const names = store.library.teams.map((t) => t.name);
    const created: string[] = [];
    const skipped = { unticked: 0, duplicate: 0, failed: 0, full: 0 };
    for (const row of rows) {
      if (!row.ok) { skipped.failed++; continue; }
      if (!row.checked) { if (row.dupOf) skipped.duplicate++; else skipped.unticked++; continue; }
      if (store.library.teams.length >= LIMITS.teams) { skipped.full++; continue; }
      let paste = row.paste;
      let estimated: string[] = [];
      if (fill.checked && dex) {
        const filled = fillSpreads(row.sets, dex);
        if (filled.estimated.length) { paste = writeTeam(filled.sets); estimated = filled.estimated; }
      }
      const name = nameFor(row.sets, row.name, names);
      names.push(name);
      const team = newTeam(name, paste.slice(0, LIMITS.textLength));
      setEstimated(team, estimated);
      store.library.teams.push(team);
      created.push(team.id);
    }
    const first = created[0];
    if (!first) return;
    Object.assign(store.ui, { teamId: first, planId: null, tabId: null, selectedNode: null });
    store.ui.open[first] = true;
    store.persist();
    close();
    requestRender();

    const reasons = [
      skipped.unticked ? `${skipped.unticked} unticked` : '',
      skipped.duplicate ? plural(skipped.duplicate, 'duplicate') : '',
      skipped.failed ? `${plural(skipped.failed, 'link')} not loaded` : '',
      skipped.full ? `${skipped.full} over the ${LIMITS.teams}-team limit` : '',
    ].filter(Boolean);
    const total = skipped.unticked + skipped.duplicate + skipped.failed + skipped.full;
    const unfilled = fill.checked && !dex;
    toast(`Imported ${plural(created.length, 'team')}${total ? `, ${total} skipped (${reasons.join(', ')})` : ''}.${unfilled ? ' Spreads were not filled: the Pokémon data could not be loaded.' : ''}`, unfilled);
  };

  const importBackup = (): void => {
    const text = box.value.trim();
    if (!text) { error.textContent = 'Choose a file or paste some JSON first.'; return; }
    let message: string;
    try { message = importText(text); }
    catch (e) { error.textContent = e instanceof DataError ? e.message : 'Import failed.'; return; }
    if (fetchedFrom) { store.ui.importUrl = fetchedFrom; store.persist(); }
    close();
    requestRender();
    toast(message);
  };

  const loadFile = async (chosenFile: File): Promise<void> => {
    error.textContent = '';
    if (chosenFile.size > MAX_FILE_BYTES) { error.textContent = 'That file is too large to be a list of teams or a backup (2 MB at most).'; return; }
    let text: string;
    try { text = await chosenFile.text(); } catch { error.textContent = 'That file could not be read.'; return; }
    if (!overlay.isConnected) return;
    useText(text);
    if (tab === 'pastes') status.textContent = `Added the text of ${chosenFile.name}. Press Preview.`;
  };

  /** Text from a file or a URL: a backup replaces the box; a text file of teams is added after what is already there, as teams of its own. */
  const useText = (text: string): void => {
    const append = tab === 'pastes' && !looksLikeBackup(text) && box.value.trim() !== '';
    box.value = append ? `${box.value.trimEnd()}\n\n---\n\n${text}` : text;
    textChanged();
  };

  /** Fetches the backup at the URL field's address into the box, then on exactly as if that file had been chosen. */
  const fetchUrl = async (): Promise<void> => {
    if (tab !== 'backup' || busy) return;
    error.textContent = '';
    status.textContent = '';
    let href: string;
    try { href = checkBackupUrl(urlField.value); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); urlField.focus(); return; }
    const token = ++fetchToken;
    const stale = (): boolean => token !== fetchToken || !overlay.isConnected;
    setBusy(true);
    status.textContent = `Fetching the backup from ${new URL(href).host}…`;
    try {
      const text = await fetchBackup(href);
      if (stale()) return;
      useText(text);
      fetchedFrom = href;
    } catch (e) {
      if (stale()) return;
      status.textContent = '';
      error.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      if (overlay.isConnected) setBusy(false);
    }
  };

  // Capture on window, so Escape closes only this dialog.
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => {
    previewToken++;
    fetchToken++;
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
    previouslyFocused?.focus();
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  $('#imp-cancel').addEventListener('click', close);
  overlay.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    setTab(b.dataset.tab === 'backup' ? 'backup' : 'pastes');
    if (rows.length === 0 && tab === 'pastes' && looksLikeBackup(box.value)) status.textContent = 'This text is a backup file from this app: use the Backup file tab to import it.';
  }));
  box.addEventListener('input', textChanged);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void preview(); }
  });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void loadFile(f); });
  previewBtn.addEventListener('click', () => void preview());
  fetchBtn.addEventListener('click', () => void fetchUrl());
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void fetchUrl(); } });
  go.addEventListener('click', () => { if (tab === 'backup') importBackup(); else importTeams(); });

  const rowOf = (target: EventTarget | null): TeamRow | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-row]') : null;
    const row = el ? rows[Number(el.dataset.row)] : undefined;
    return row?.ok ? row : null;
  };
  list.addEventListener('input', (e) => {
    const row = rowOf(e.target);
    if (row && e.target instanceof HTMLInputElement && e.target.classList.contains('imp-name')) row.name = e.target.value;
  });
  list.addEventListener('change', (e) => {
    const row = rowOf(e.target);
    if (!row || !(e.target instanceof HTMLInputElement) || !e.target.classList.contains('imp-on')) return;
    row.checked = e.target.checked;
    e.target.closest('.imp-row')?.classList.toggle('off', !row.checked);
    drawFoot();
  });

  must('#layer').appendChild(overlay);
  setTab(tab);
  urlField.value = url ?? store.ui.importUrl ?? '';
  if (url) void fetchUrl();
  else box.focus();
}

/** A `?import=<url>` link (see readImportLink): opens the Backup tab and starts the fetch; nothing is imported until the user presses Import. */
export function openImportLink(url: string | null): void {
  if (url) openImport('backup', { url });
  else toast('The import link was ignored: its address must start with https:// (or http://).', true);
}
