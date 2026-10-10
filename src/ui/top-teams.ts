/**
 * "Top teams": six-Pokémon cores built from Smogon's teammate data (see src/domain/top-teams.ts), each with the
 * members' most common builds and a choice of spread per member. The caller decides what a team is for: load it into
 * a paste box, make it your team, or plan against it.
 */
import type { Dex, UsageMon } from '../domain/dex.ts';
import { spreadLine } from '../domain/dex.ts';
import { REGULATION } from '../domain/regulation.ts';
import { buildTopTeams, topTeamSets } from '../domain/top-teams.ts';
import type { TopTeam } from '../domain/top-teams.ts';
import type { PokemonSet } from '../domain/types.ts';
import { pct } from './builder-html.ts';
import { esc } from './dom.ts';
import { itemIcon, monIcon } from './icons.ts';

export interface TopTeamAction {
  label: string;
  cls?: string;
  run: (sets: PokemonSet[], team: TopTeam) => void;
}

/** The "★ Top teams" button placed under a `data-team-paste` box; `target` selects that box. */
export function topTeamsButton(targetSelector: string): string {
  return `<div class="btn-row mt-s"><button type="button" class="btn sm" data-act="top-teams" data-target="${esc(targetSelector)}">★ Top teams</button></div>`;
}

let built: { dex: Dex; teams: TopTeam[] } | null = null;
/** Building takes a few milliseconds; once per loaded dataset is enough. */
const teamsFor = (dex: Dex): TopTeam[] => {
  if (built?.dex !== dex) built = { dex, teams: buildTopTeams(dex) };
  return built.teams;
};

function memberCard(mon: UsageMon, set: PokemonSet, chosen: number, teamId: string): string {
  const spreads = mon.spreads.map(([nature, sp, p], i) =>
    `<option value="${i}"${i === chosen ? ' selected' : ''}>${esc(nature)} · ${esc(spreadLine(sp) || 'no Stat Points')} · ${esc(pct(p))}</option>`).join('');
  return `<div class="tt-card">
    <div class="tt-card-head">${monIcon(mon.name, 'sm')}<span class="tt-card-name"><b>${esc(set.species)}</b>
      <span class="tt-card-item">${set.item ? `${itemIcon(set.item, 'xs')}${esc(set.item)}` : 'No item'}</span></span></div>
    <div class="tt-card-ability">${esc(set.ability)}</div>
    <ul class="tt-moves">${set.moves.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    ${mon.spreads.length ? `<select class="field tt-spread" data-team="${esc(teamId)}" data-member="${esc(mon.name)}" aria-label="${esc(set.species)} spread">${spreads}</select>` : '<span class="hint">No spread data</span>'}
  </div>`;
}

/** Opens the picker. Each action becomes a button on an opened team and closes the picker when used. */
export function openTopTeams(dex: Dex, actions: TopTeamAction[]): void {
  const usage = dex.usage;
  if (!usage) return;
  const teams = teamsFor(dex);
  const spreads: Record<string, Record<string, number>> = {};
  let open: string | null = null;
  let query = '';

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Top teams">
    <div class="modal-head"><h2>Top teams · ${esc(REGULATION.label)}</h2>
      <p>Cores built from Smogon teammate data for ${esc(usage.month)}, not real tournament team lists.</p>
      <input class="input mt-s" id="tt-search" placeholder="Filter by Pokémon…" autocomplete="off"></div>
    <div class="modal-body tb-list" id="tt-list"></div>
    <div class="modal-foot"><span class="hint tb-foot">Synergy: how often these six appear together, summed over every pair.</span><button class="btn" id="tt-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector<HTMLElement>('#tt-list')!;
  const search = overlay.querySelector<HTMLInputElement>('#tt-search')!;

  const setsFor = (t: TopTeam): PokemonSet[] => topTeamSets(t, dex, spreads[t.id] ?? {});
  const matches = (t: TopTeam): boolean =>
    !query || query.split(/\s+/).every((w) => t.members.some((m) => m.name.toLowerCase().includes(w)));

  const draw = (): void => {
    list.innerHTML = teams.filter(matches).map((t) => {
      const rank = teams.indexOf(t) + 1;
      const isOpen = open === t.id;
      let detail = '';
      if (isOpen) {
        const sets = setsFor(t);
        detail = `<div class="tt-detail"><div class="tt-cards">${t.members.map((m, i) => memberCard(m, sets[i]!, spreads[t.id]?.[m.name] ?? 0, t.id)).join('')}</div>
          <div class="btn-row tt-actions">${actions.map((a, i) => `<button type="button" class="btn sm ${esc(a.cls ?? '')}" data-run="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
      }
      return `<div class="tb-row${isOpen ? ' open' : ''}" data-team-id="${esc(t.id)}">
        <div class="tt-summary" role="button" tabindex="0" aria-expanded="${isOpen}" data-toggle="${esc(t.id)}">
          <span class="tb-rank">#${rank}</span>
          <span class="tt-icons">${t.members.map((m) => monIcon(m.name, 'sm')).join('')}</span>
          <span class="tt-name"><b>${esc(t.name)}</b></span>
          <span class="tt-score" title="Teammate synergy">${esc(String(Math.round(t.score)))} synergy</span>
        </div>${detail}</div>`;
    }).join('') || '<p class="hint">Nothing matches.</p>';
  };

  // Capture on window, so Escape closes only this picker and not a dialog it was opened from.
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => { overlay.remove(); window.removeEventListener('keydown', onKey, true); };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#tt-close')!.addEventListener('click', close);
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });

  const toggle = (id: string): void => { open = open === id ? null : id; draw(); };
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const team = teams.find((x) => x.id === t.closest<HTMLElement>('[data-team-id]')?.dataset.teamId);
    if (!team) return;
    const run = t.closest<HTMLElement>('[data-run]');
    if (run) {
      const action = actions[Number(run.dataset.run)];
      if (!action) return;
      const sets = setsFor(team);
      close();
      action.run(sets, team);
      return;
    }
    if (t.closest('[data-toggle]')) toggle(team.id);
  });
  list.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) || !t.classList.contains('tt-spread')) return;
    const id = t.dataset.team ?? '';
    const member = t.dataset.member ?? '';
    (spreads[id] ??= {})[member] = Number(t.value);
    draw();
    list.querySelector<HTMLSelectElement>(`.tt-spread[data-member="${CSS.escape(member)}"]`)?.focus();
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.dataset.toggle) { e.preventDefault(); toggle(t.dataset.toggle); }
  });
  draw();
  search.focus();
}
