/**
 * "★ Top teams": the teams listed by a team feed (see domain/team-feed.ts), with who played them, where, and whether
 * their spreads were published. Opening a team downloads its paste and previews the six sets; sets without a spread
 * get the most used one from Smogon usage, labelled ESTIMATED. The caller decides what a team is for: load it into a
 * paste box, make it your team, or plan against it.
 */
import { config } from '../config.ts';
import type { Dex } from '../domain/dex.ts';
import { parseShowdown } from '../domain/showdown.ts';
import { OFFICIAL_TIERS, TIER_LABEL, fillSpreads, placingLabel, resolvePaste, stillEstimated } from '../domain/team-feed.ts';
import type { FeedEntry, FeedTier, TeamFeed } from '../domain/team-feed.ts';
import type { PokemonSet } from '../domain/types.ts';
import { checkFeedUrl, fetchFeedPaste, loadFeed } from '../infra/team-feed.ts';
import { store } from '../state/instance.ts';
import { esc } from './dom.ts';
import { itemIcon, monIcon } from './icons.ts';
import { moveLabel } from './move-type.ts';

export interface TopTeamAction {
  label: string;
  cls?: string;
  /** `label` is the feed entry's title; `estimated` lists the species whose spread was filled from usage. */
  run: (sets: PokemonSet[], label: string, estimated: string[]) => void;
}

/** The "★ Top teams" button placed under a `data-team-paste` box; `target` selects that box. */
export function topTeamsButton(targetSelector: string): string {
  return `<div class="btn-row mt-s"><button type="button" class="btn sm" data-act="top-teams" data-target="${esc(targetSelector)}">★ Top teams</button></div>`;
}

/** The feed the picker opens with: the user's choice, else the configured default (none in production). */
export const currentFeedUrl = (): string => store.ui.teamFeedUrl ?? config.teamFeed.defaultUrl;

/**
 * Remembers on a paste box which species got an estimated spread (and which spread), so that saving the box can
 * label them. Editing a set's spread by hand in the box makes it the user's own again (see {@link boxEstimates}).
 */
export function markBoxEstimates(box: HTMLTextAreaElement, sets: readonly PokemonSet[], estimated: readonly string[]): void {
  const filled: Record<string, string> = {};
  for (const s of sets) if (estimated.includes(s.species)) filled[s.species] = s.evs.trim();
  if (estimated.length) box.dataset.estimated = JSON.stringify(filled);
  else delete box.dataset.estimated;
}

/** The species of a paste box whose spread is still the one filled in from usage. */
export function boxEstimates(box: HTMLTextAreaElement | null | undefined): string[] {
  if (!box?.dataset.estimated) return [];
  try {
    const filled = JSON.parse(box.dataset.estimated) as unknown;
    if (typeof filled !== 'object' || filled === null || Array.isArray(filled)) return [];
    const record = Object.fromEntries(Object.entries(filled).filter((kv): kv is [string, string] => typeof kv[1] === 'string'));
    return stillEstimated(parseShowdown(box.value), record);
  } catch { return []; }
}

export const estimatedToast = (estimated: readonly string[]): string => `Spreads estimated from usage for: ${estimated.join(', ')}`;

type Chip = 'all' | 'official' | 'online' | 'ranked' | 'creator';
const CHIPS: ReadonlyArray<[Chip, string]> = [['all', 'All'], ['official', 'Official'], ['online', 'Online'], ['ranked', 'Ranked'], ['creator', 'Creator']];
const inChip = (tier: FeedTier, chip: Chip): boolean => chip === 'all' || (chip === 'official' ? OFFICIAL_TIERS.includes(tier) : tier === chip);

/** A team's paste, downloaded and filled: what the preview shows and the actions receive. */
interface Loaded { sets: PokemonSet[]; estimated: string[]; confirmed: Set<number> }
type Preview = { state: 'loading' } | { state: 'error'; message: string } | ({ state: 'ok' } & Loaded);

/** Downloaded paste texts, by URL, for the session. */
const pasteCache = new Map<string, Promise<string>>();
function pasteText(url: string): Promise<string> {
  let p = pasteCache.get(url);
  if (!p) {
    p = fetchFeedPaste(url);
    pasteCache.set(url, p);
    p.catch(() => pasteCache.delete(url));
  }
  return p;
}

const SPREADS_BADGE: Record<FeedEntry['spreads'], string> = {
  confirmed: '<span class="tt-badge ok" title="The player published every spread">Confirmed spreads</span>',
  partial: '<span class="tt-badge part" title="The player published some of the spreads; the rest are estimated from usage">Partly confirmed</span>',
  estimated: '<span class="tt-badge est" title="No spreads were published; they are estimated from Smogon usage">Estimated spreads</span>',
};

const formatDate = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function setCard(set: PokemonSet, confirmed: boolean, estimated: boolean, dex: Dex): string {
  const spread = set.evs
    ? `${esc(set.nature ? `${set.nature} · ` : '')}${esc(set.evs)}`
    : '<span class="muted">No spread (no usage data for it)</span>';
  const badge = confirmed ? '<span class="tt-badge ok" title="Published by the player">CONFIRMED</span>' : estimated ? '<span class="tt-badge est" title="Most used spread from Smogon usage">ESTIMATED</span>' : '';
  return `<div class="tt-card">
    <div class="tt-card-head">${monIcon(set.species, 'sm')}<span class="tt-card-name"><b>${esc(set.species)}</b>
      <span class="tt-card-item">${set.item ? `${itemIcon(set.item, 'xs')}${esc(set.item)}` : 'No item'}</span></span></div>
    ${set.ability ? `<div class="tt-card-ability">${esc(set.ability)}</div>` : ''}
    <ul class="tt-moves">${set.moves.map((m) => `<li>${moveLabel(m, { type: dex.move(m)?.type ?? null })}</li>`).join('')}</ul>
    <div class="tt-spread">${badge}<span>${spread}</span></div>
  </div>`;
}

/** Opens the picker. Each action becomes a button on an opened team and closes the picker when used. */
export function openTopTeams(dex: Dex, actions: TopTeamAction[]): void {
  let feedUrl = currentFeedUrl();
  let feed: TeamFeed | null = null;
  let feedError = '';
  let loading = false;
  let loadToken = 0;
  let open: string | null = null;
  let query = '';
  let chip: Chip = 'all';
  let onlyConfirmed = false;
  const previews = new Map<string, Preview>();

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide tt-modal" role="dialog" aria-modal="true" aria-label="Top teams">
    <div class="modal-head"><h2>Top teams</h2>
      <div class="tt-feed"><label class="lbl" for="tt-url">Team feed</label>
        <div class="tt-feed-row"><input class="input" id="tt-url" type="url" inputmode="url" spellcheck="false" autocomplete="off" placeholder="https://example.com/feed.json" value="${esc(feedUrl)}">
        <button type="button" class="btn sm" id="tt-load">Load</button></div>
        <p class="hint tt-meta" id="tt-meta" role="status"></p></div>
      <div class="tt-filters">
        <input class="input" id="tt-search" placeholder="Search by player, event or title…" autocomplete="off" aria-label="Search teams">
        <div class="seg" role="group" aria-label="Kind of event">${CHIPS.map(([c, l]) => `<button type="button" class="seg-btn${c === chip ? ' on' : ''}" data-chip="${c}" aria-pressed="${c === chip}">${esc(l)}</button>`).join('')}</div>
        <label class="tt-check"><input type="checkbox" id="tt-confirmed"> Only confirmed spreads</label>
      </div></div>
    <div class="modal-body tb-list" id="tt-list"></div>
    <div class="modal-foot"><span class="hint tb-foot" id="tt-count"></span><button type="button" class="btn" id="tt-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  const $ = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
  const list = $<HTMLElement>('#tt-list');
  const meta = $<HTMLElement>('#tt-meta');
  const count = $<HTMLElement>('#tt-count');
  const urlField = $<HTMLInputElement>('#tt-url');
  const search = $<HTMLInputElement>('#tt-search');

  const matches = (e: FeedEntry): boolean => {
    if (!inChip(e.tier, chip)) return false;
    if (onlyConfirmed && e.spreads !== 'confirmed') return false;
    if (!query) return true;
    const hay = `${e.player} ${e.event} ${e.title}`.toLowerCase();
    return query.split(/\s+/).every((w) => hay.includes(w));
  };

  const drawMeta = (): void => {
    meta.classList.toggle('err-text', !!feedError);
    if (feedError) { meta.textContent = feedError; return; }
    if (loading) { meta.textContent = 'Loading the feed…'; return; }
    if (!feed) { meta.textContent = 'No team feed yet. Enter the address of a team feed (a .json file published by a site that collects teams) and press Load.'; return; }
    const sources = feed.sources.length
      ? feed.sources.map((s) => `${s.label} ${s.teams}`).join(' · ')
      : `${feed.entries.length} teams`;
    const updated = formatDate(feed.generated);
    meta.textContent = [feed.format, updated && `updated ${updated}`, sources].filter(Boolean).join(' · ');
  };

  const previewHTML = (e: FeedEntry): string => {
    if (!e.paste) return '<p class="hint">Only the Pokémon are known for this team (no paste was published), so there is nothing to load. The replica codes above load it in the game.</p>';
    const p = previews.get(e.id);
    if (!p || p.state === 'loading') return '<p class="hint" role="status">Loading the team…</p>';
    if (p.state === 'error') return `<p class="err-text" role="alert">${esc(p.message)}</p>`;
    if (!p.sets.length) return '<p class="err-text">This paste has no Pokémon in it.</p>';
    return `<div class="tt-cards">${p.sets.map((s, i) => setCard(s, p.confirmed.has(i), p.estimated.includes(s.species), dex)).join('')}</div>`;
  };

  const detailHTML = (e: FeedEntry): string => {
    const p = previews.get(e.id);
    const ready = !!e.paste && p?.state === 'ok' && p.sets.length > 0;
    const why = !e.paste ? 'This team was published without its sets, so it can’t be loaded.' : 'Wait for the team to load.';
    const links = [
      e.source ? `<a href="${esc(e.source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : '',
      e.spreadUrl ? `<a href="${esc(e.spreadUrl)}" target="_blank" rel="noopener noreferrer">Spreads from ${esc(e.spreadSource || 'the player')} ↗</a>` : '',
      e.replicaCodes?.length ? `<span>Replica codes: <b class="tt-codes">${e.replicaCodes.map(esc).join(' ')}</b></span>` : '',
    ].filter(Boolean).join('');
    return `<div class="tt-detail">
      ${links ? `<div class="tt-links">${links}</div>` : ''}
      ${previewHTML(e)}
      <div class="btn-row tt-actions">${actions.map((a, i) => `<button type="button" class="btn sm ${esc(a.cls ?? '')}" data-run="${i}"${ready ? '' : ` disabled title="${esc(why)}"`}>${esc(a.label)}</button>`).join('')}</div></div>`;
  };

  const draw = (): void => {
    drawMeta();
    if (!feed) { list.innerHTML = ''; count.textContent = ''; return; }
    const rows = feed.entries.filter(matches);
    count.textContent = `${rows.length} of ${feed.entries.length} teams`;
    const index = new Map(feed.entries.map((e, i) => [e.id, i + 1]));
    list.innerHTML = rows.map((e) => {
      const isOpen = open === e.id;
      const sub = [TIER_LABEL[e.tier], e.event, placingLabel(e.placing), e.date].filter(Boolean).map(esc).join(' · ');
      const badges = [
        SPREADS_BADGE[e.spreads],
        e.replicaCodes?.length ? `<span class="tt-badge code" title="In-game rental codes">Replica ${e.replicaCodes.map(esc).join(' ')}</span>` : '',
        e.paste ? '' : '<span class="tt-badge est" title="No paste was published for this team">Pokémon only</span>',
      ].join('');
      return `<div class="tb-row${isOpen ? ' open' : ''}" data-entry="${esc(e.id)}">
        <div class="tt-summary" role="button" tabindex="0" aria-expanded="${isOpen}" data-toggle="${esc(e.id)}">
          <span class="tb-rank">#${index.get(e.id) ?? ''}</span>
          <span class="tt-main"><b>${esc(e.player || e.title)}</b><span class="tt-sub">${sub}</span></span>
          <span class="tt-badges">${badges}</span>
        </div>${isOpen ? detailHTML(e) : ''}</div>`;
    }).join('') || '<p class="hint">No team matches.</p>';
  };

  const loadPreview = async (e: FeedEntry): Promise<void> => {
    if (!e.paste || previews.get(e.id)?.state === 'ok' || previews.get(e.id)?.state === 'loading') return;
    previews.set(e.id, { state: 'loading' });
    const base = feedUrl;
    try {
      const url = resolvePaste(base, e);
      if (!url) return;
      const parsed = parseShowdown(await pasteText(url)).slice(0, 6);
      const confirmed = new Set(parsed.map((s, i) => (s.evs.trim() ? i : -1)).filter((i) => i >= 0));
      previews.set(e.id, { state: 'ok', confirmed, ...fillSpreads(parsed, dex) });
    } catch (err) {
      previews.set(e.id, { state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (overlay.isConnected && open === e.id) draw();
  };

  const load = async (fresh: boolean): Promise<void> => {
    const token = ++loadToken;
    feedError = '';
    if (!feedUrl) { feed = null; draw(); return; }
    loading = true;
    draw();
    try {
      const next = await loadFeed(feedUrl, { fresh });
      if (token !== loadToken) return;
      feed = next;
      open = null;
      previews.clear();
    } catch (err) {
      if (token !== loadToken) return;
      feed = null;
      feedError = err instanceof Error ? err.message : String(err);
    } finally {
      if (token === loadToken) loading = false;
    }
    if (overlay.isConnected) draw();
  };

  const useUrl = (): void => {
    const raw = urlField.value.trim();
    if (!raw) {
      feedUrl = '';
      store.ui.teamFeedUrl = '';
      store.persist();
      void load(false);
      return;
    }
    try { feedUrl = checkFeedUrl(raw); } catch (err) {
      feed = null;
      feedError = err instanceof Error ? err.message : String(err);
      draw();
      return;
    }
    urlField.value = feedUrl;
    store.ui.teamFeedUrl = feedUrl;
    store.persist();
    void load(true);
  };

  // Capture on window, so Escape closes only this picker and not a dialog it was opened from.
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => { loadToken++; overlay.remove(); window.removeEventListener('keydown', onKey, true); };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  $('#tt-close').addEventListener('click', close);
  $('#tt-load').addEventListener('click', useUrl);
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useUrl(); } });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });
  $<HTMLInputElement>('#tt-confirmed').addEventListener('change', (e) => { onlyConfirmed = (e.target as HTMLInputElement).checked; draw(); });
  overlay.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    chip = (CHIPS.find(([c]) => c === b.dataset.chip)?.[0]) ?? 'all';
    overlay.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    draw();
  }));

  const toggle = (id: string): void => {
    open = open === id ? null : id;
    draw();
    const entry = feed?.entries.find((x) => x.id === open);
    if (entry) void loadPreview(entry);
  };
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('a')) return;
    const entry = feed?.entries.find((x) => x.id === t.closest<HTMLElement>('[data-entry]')?.dataset.entry);
    if (!entry) return;
    const run = t.closest<HTMLButtonElement>('[data-run]');
    if (run) {
      const action = actions[Number(run.dataset.run)];
      const p = previews.get(entry.id);
      if (!action || run.disabled || p?.state !== 'ok') return;
      close();
      action.run(structuredClone(p.sets), entry.title, [...p.estimated]);
      return;
    }
    if (t.closest('[data-toggle]')) toggle(entry.id);
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.dataset.toggle) { e.preventDefault(); toggle(t.dataset.toggle); list.querySelector<HTMLElement>(`[data-toggle="${CSS.escape(t.dataset.toggle)}"]`)?.focus(); }
  });

  draw();
  void load(false);
  search.focus();
}
