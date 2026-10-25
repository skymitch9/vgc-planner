import { reconcileLibrary, snapshotLibrary } from '../domain/library-sync.ts';
import type { LibraryBase } from '../domain/library-sync.ts';
import { findNode, findPlan, findTab, findTeam, sheetOf } from '../domain/model.ts';
import type { NodeLocation } from '../domain/model.ts';
import type { Library, Plan, PlanTab, Sheet, Team } from '../domain/types.ts';
import type { PrefsStore } from '../infra/prefs.ts';
import { StaleLibraryError } from '../infra/repository.ts';
import type { LibraryRepository } from '../infra/repository.ts';
import { config } from '../config.ts';

export interface UiState {
  teamId: string | null;
  planId: string | null;
  /** The open tab of the open gameplan (null: its first tab). */
  tabId: string | null;
  /** The turn open in the editor drawer. */
  selectedNode: string | null;
  open: Record<string, boolean>;
  zoom: number;
  /** Turn cards whose battle log is open (kept for the session only). */
  expanded: Record<string, boolean>;
  /** Sidebar folded down to a thin rail. */
  navCollapsed: boolean;
  /** The team feed chosen in the "★ Top teams" picker (null: the configured default). */
  teamFeedUrl: string | null;
  /** The last address a backup was fetched from in the Import dialog (null: none yet). */
  importUrl: string | null;
  /** The turn whose named line is highlighted from the legend (others are dimmed); null for none. */
  focusLine?: string | null;
  scrollX: number;
  scrollY: number;
  /** Phones: Path (one line of play at a time) or Overview (an outline of every turn). */
  mobileView: 'path' | 'tree';
  /** Phones: the alternative followed at each fork (key: the parent turn's id, or the tab's id for the first turn). */
  pathPick: Record<string, string>;
  /** Phones: turns folded in the Overview. */
  folded: Record<string, boolean>;
  /** Phones: the team menu slid open. */
  navOpen: boolean;
  /** Phones: the "Teams, leads and backs" section opened or closed by hand (unset: open only while it needs filling). */
  setupOpen?: boolean;
}

/**
 * Holds the library and the view state, and writes changes through the repository. Mutate `library` / `ui`
 * directly, then call {@link persist}; saving is debounced and failures are reported through `onError`.
 */
export class AppStore {
  library: Library = { teams: [] };
  ui: UiState = { teamId: null, planId: null, tabId: null, selectedNode: null, open: {}, expanded: {}, zoom: 1, navCollapsed: false, teamFeedUrl: null, importUrl: null, scrollX: 0, scrollY: 0,
    mobileView: 'path', pathPick: {}, folded: {}, navOpen: false };
  /** False when browser storage is unavailable and data only lives until the tab closes. */
  persistent: boolean;
  /** Set when saved data could not be read on startup. */
  loadError: string | null = null;
  onError: (message: string) => void = () => {};
  /** Save progress, for the "Saving… / Saved" hint: `pending` while edits wait to be sent. */
  saveState: 'saved' | 'pending' | 'saving' | 'error' = 'saved';
  onSaveState: (state: AppStore['saveState']) => void = () => {};
  /** Called after changes saved in another tab were merged into `library` (redraw and tell the user). */
  onExternalChange: () => void = () => {};

  private repo: LibraryRepository;
  private readonly prefs: PrefsStore;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The library as last loaded or saved (or merged from storage): what "changed here since" is measured against. */
  private base: LibraryBase = snapshotLibrary({ teams: [] });
  private unwatch: () => void = () => {};
  /**
   * The selection saved in the preferences, kept while it isn't open yet: a signed-in user's team only exists once
   * the account library loads, after startup has loaded the device library.
   */
  private wanted: Pick<UiState, 'teamId' | 'planId' | 'tabId'> | null = null;

  constructor(repo: LibraryRepository, prefs: PrefsStore, persistent = true) {
    this.repo = repo;
    this.prefs = prefs;
    this.persistent = persistent;
  }

  async init(): Promise<void> {
    await this.loadLibrary();
    const p = this.prefs.load();
    this.ui.open = p.open;
    this.ui.navCollapsed = p.navCollapsed;
    this.ui.teamFeedUrl = p.teamFeedUrl ?? null;
    this.ui.importUrl = p.importUrl ?? null;
    this.ui.zoom = Math.max(config.zoom.min, Math.min(config.zoom.max, p.zoom));
    this.restoreSelection(p.teamId, p.planId, p.tabId);
    this.wanted = p.teamId !== null && this.ui.teamId === null ? { teamId: p.teamId, planId: p.planId, tabId: p.tabId } : null;
  }

  /**
   * Switches where the library lives (this device, or the signed-in account): pending edits are saved to the old
   * place first, then the library is loaded from the new one. The open team / gameplan stays open if it exists there.
   */
  async useRepository(repo: LibraryRepository, persistent = true): Promise<void> {
    await this.flush();
    this.repo = repo;
    this.persistent = persistent;
    await this.loadLibrary();
    const sel = this.ui.teamId !== null ? this.ui : this.wanted ?? this.ui;
    this.wanted = null;
    this.restoreSelection(sel.teamId, sel.planId, sel.tabId);
  }

  /** Where the library currently lives. */
  get repository(): LibraryRepository { return this.repo; }

  private async loadLibrary(): Promise<void> {
    this.unwatch();
    this.loadError = null;
    try {
      this.library = await this.repo.load();
    } catch (e) {
      this.library = { teams: [] };
      this.loadError = e instanceof Error ? e.message : String(e);
    }
    this.base = snapshotLibrary(this.library);
    this.unwatch = this.repo.watch?.((stored) => { this.receive(stored); }) ?? (() => {});
  }

  /** Another tab saved: merge its library in, and save again if this tab's own changes aren't in storage yet. */
  receive(stored: Library): void {
    if (this.merge(stored) && this.timer === null) this.persist();
  }

  /**
   * Merges the stored library into `library` record by record (see domain/library-sync.ts): what was changed here
   * since the last save stays, everything else takes the stored version. Returns whether this tab still has changes
   * to save.
   */
  private merge(stored: Library): boolean {
    const result = reconcileLibrary(this.base, this.library, stored);
    this.library = result.library;
    this.base = snapshotLibrary(stored);
    if (result.changed) {
      this.restoreSelection(this.ui.teamId, this.ui.planId, this.ui.tabId);
      if (this.ui.selectedNode !== null && !this.currentNode()) this.ui.selectedNode = null;
      this.onExternalChange();
    }
    return result.unsaved;
  }

  private restoreSelection(teamId: string | null, planId: string | null, tabId: string | null): void {
    const team = findTeam(this.library, teamId);
    this.ui.teamId = team?.id ?? null;
    const plan = findPlan(team, planId);
    this.ui.planId = plan?.id ?? null;
    this.ui.tabId = plan ? findTab(plan, tabId).id : null;
    if (!plan) this.ui.selectedNode = null;
  }

  private setSaveState(state: AppStore['saveState']): void {
    this.saveState = state;
    this.onSaveState(state);
  }

  get team(): Team | undefined { return findTeam(this.library, this.ui.teamId); }
  get plan(): Plan | undefined { return findPlan(this.team, this.ui.planId); }
  /** The open tab (the gameplan's first tab if none is chosen). */
  get tab(): PlanTab | undefined { const plan = this.plan; return plan ? findTab(plan, this.ui.tabId) : undefined; }
  /** The open tab together with its gameplan's opponent: what the canvas, editor and simulation work on. */
  get sheet(): Sheet | undefined { const plan = this.plan; const tab = this.tab; return plan && tab ? sheetOf(plan, tab) : undefined; }

  /** The turn currently open in the editor, with its position in the tree. */
  currentNode(): NodeLocation | null {
    const tab = this.tab;
    return tab ? findNode(tab.children, this.ui.selectedNode) : null;
  }

  /** Schedules a save. Call after every change to `library` or the persisted parts of `ui`. */
  persist(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.saveState !== 'pending') this.setSaveState('pending');
    this.timer = setTimeout(() => { void this.flush(); }, this.repo.saveDelayMs ?? config.storage.saveDelayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    // Until the remembered selection gets its chance, keep it in the preferences rather than an empty one.
    const sel = this.ui.teamId === null && this.wanted ? this.wanted : this.ui;
    this.prefs.save({ teamId: sel.teamId, planId: sel.planId, tabId: sel.tabId, open: this.ui.open, zoom: this.ui.zoom, navCollapsed: this.ui.navCollapsed, teamFeedUrl: this.ui.teamFeedUrl, importUrl: this.ui.importUrl });
    this.setSaveState('saving');
    try {
      await this.save();
      // A newer edit may have been scheduled while this save was in flight.
      if (this.timer === null) this.setSaveState('saved');
    } catch (e) {
      this.setSaveState('error');
      this.onError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Saves the library; when another tab saved first, merges that in and saves the result instead. */
  private async save(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const saving = snapshotLibrary(this.library);
      try {
        await this.repo.save(this.library);
        this.base = saving;
        return;
      } catch (e) {
        if (!(e instanceof StaleLibraryError) || attempt >= 5) throw e;
        if (!this.merge(e.stored)) return; // storage already holds everything this tab has
      }
    }
  }
}
