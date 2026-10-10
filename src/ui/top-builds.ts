/**
 * "Top builds": the regulation's Pokémon ranked by Smogon usage, each with what people actually run (items,
 * abilities, moves, Stat Point spreads, teammates). One click puts the most common build, or a chosen spread, on
 * the team. Every build is checked against the legality data before it's offered.
 */
import type { Dex, Share, UsageMon } from '../domain/dex.ts';
import { setFromUsage, setProblems, spreadLine, toID } from '../domain/dex.ts';
import { REGULATION } from '../domain/regulation.ts';
import type { PokemonSet } from '../domain/types.ts';
import { pct, typeChip } from './builder-html.ts';
import { esc } from './dom.ts';
import { itemIcon, monIcon } from './icons.ts';

export type ApplyBuild = (set: PokemonSet, replaceSlot: number | null) => void;

const bars = (rows: Share[], icon?: (n: string) => string): string =>
  rows.map(([name, p]) => `<div class="share"><span class="share-name">${icon ? icon(name) : ''}${esc(name)}</span>
    <span class="share-bar"><span class="bar" data-w="${Math.round(Math.min(100, p))}"></span></span><span class="share-pct">${pct(p)}</span></div>`).join('');

function detailHTML(mon: UsageMon, dex: Dex): string {
  return `<div class="tb-detail">
    <div class="tb-col"><h4>Moves</h4>${bars(mon.moves.slice(0, 10), (n) => { const m = dex.move(n); return m ? typeChip(m.type) : ''; })}</div>
    <div class="tb-col"><h4>Items</h4>${bars(mon.items.slice(0, 6), (n) => itemIcon(n, 'xs'))}
      <h4>Abilities</h4>${bars(mon.abilities)}</div>
    <div class="tb-col"><h4>Spreads <span class="hint">(Stat Points)</span></h4>
      ${mon.spreads.map(([nature, sp, p], i) => `<div class="share spread"><span class="share-name"><b>${esc(nature)}</b> ${esc(spreadLine(sp) || 'none')}</span>
        <span class="share-pct">${pct(p)}</span><button class="btn sm" data-use-spread="${i}" title="Use this spread">Use</button></div>`).join('')}
      ${mon.mates.length ? `<h4>Teammates</h4><div class="mate-row">${mon.mates.slice(0, 8).map(([n, p]) => `<span class="mate" title="On ${p}% of its teams">${monIcon(n, 'xs')}${esc(n)}</span>`).join('')}</div>` : ''}
    </div></div>`;
}

export function openTopBuilds(dex: Dex, team: readonly PokemonSet[], selectedSlot: number, apply: ApplyBuild): void {
  const usage = dex.usage;
  if (!usage) return;
  const mons = usage.mons.filter((m) => setProblems(setFromUsage(m, dex), dex).length === 0);
  const full = team.length >= REGULATION.teamSize;
  const selected = team[selectedSlot];
  let open: string | null = null;
  let query = '';

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Top builds">
    <div class="modal-head"><h2>Top builds · ${esc(REGULATION.label)}</h2>
      <p>Smogon usage for ${esc(usage.month)}, ${usage.cutoff}+ rated games (${(usage.battles / 1e6).toFixed(2)}M battles). Click a Pokémon for its full breakdown.</p>
      <input class="input mt-s" id="tb-search" placeholder="Filter by Pokémon, move, item or type…" autocomplete="off"></div>
    <div class="modal-body tb-list" id="tb-list"></div>
    <div class="modal-foot"><span class="hint tb-foot">${full ? `Your team is full: builds replace slot ${selectedSlot + 1}${selected ? ` (${esc(selected.species)})` : ''}.` : `Builds are added as slot ${team.length + 1}.`}</span><button class="btn" id="tb-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector<HTMLElement>('#tb-list')!;
  const search = overlay.querySelector<HTMLInputElement>('#tb-search')!;

  const blocked = (mon: UsageMon): string | null => {
    const s = dex.species(mon.species);
    const clash = team.find((t, i) => (!full || i !== selectedSlot) && dex.species(t.species)?.num === s?.num);
    if (clash) return `${clash.species} is already on your team (Species Clause)`;
    const item = setFromUsage(mon, dex).item;
    const holder = team.find((t, i) => (!full || i !== selectedSlot) && item && toID(t.item) === toID(item));
    if (holder && mon.mega) return `${holder.species} already holds ${item} (Item Clause)`;
    return null;
  };

  const matches = (m: UsageMon): boolean => {
    if (!query) return true;
    const s = dex.species(m.species);
    const hay = [m.name, ...m.moves.slice(0, 6).map((x) => x[0]), ...m.items.slice(0, 3).map((x) => x[0]), ...(s?.types ?? [])].join(' ').toLowerCase();
    return query.split(/\s+/).every((w) => hay.includes(w));
  };

  const draw = (): void => {
    const rows = mons.filter(matches);
    list.innerHTML = rows.map((m) => {
      const rank = usage.mons.indexOf(m) + 1;
      const no = blocked(m);
      const top = setFromUsage(m, dex);
      return `<div class="tb-row${open === m.name ? ' open' : ''}" data-mon="${esc(m.name)}">
        <div class="tb-summary" role="button" tabindex="0" data-toggle="${esc(m.name)}">
          <span class="tb-rank">#${rank}</span>${monIcon(m.name, 'sm')}
          <span class="tb-name"><b>${esc(m.name)}</b><span class="tb-use">${pct(m.usage)} of teams</span></span>
          <span class="tb-set">${top.item ? `${itemIcon(top.item, 'xs')}${esc(top.item)} · ` : ''}${top.moves.map(esc).join(' / ')}</span>
          <button class="btn sm primary" data-add="${esc(m.name)}" ${no ? `disabled title="${esc(no)}"` : ''}>${full ? 'Replace' : 'Add'}</button>
        </div>${open === m.name ? detailHTML(m, dex) : ''}</div>`;
    }).join('') || '<p class="hint">Nothing matches.</p>';
    list.querySelectorAll<HTMLElement>('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w ?? 0}%`; });
  };

  const close = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#tb-close')!.addEventListener('click', close);
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });

  const use = (mon: UsageMon, spread: number): void => {
    const why = blocked(mon);
    if (why) return;
    const set = setFromUsage(mon, dex, spread);
    // Item Clause: if the top item is already taken, fall back to the next most used one that isn't.
    const taken = new Set(team.filter((_, i) => !full || i !== selectedSlot).map((t) => toID(t.item)));
    if (taken.has(toID(set.item))) set.item = mon.items.map(([n]) => n).find((n) => !taken.has(toID(n)) && dex.item(n)) ?? '';
    close();
    apply(set, full ? selectedSlot : null);
  };
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-add]');
    const row = t.closest<HTMLElement>('[data-mon]');
    const mon = mons.find((m) => m.name === row?.dataset.mon);
    if (!mon) return;
    if (add) return use(mon, 0);
    const spread = t.closest<HTMLElement>('[data-use-spread]');
    if (spread) return use(mon, Number(spread.dataset.useSpread));
    if (t.closest('[data-toggle]')) { open = open === mon.name ? null : mon.name; draw(); }
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.dataset.toggle) { e.preventDefault(); open = open === t.dataset.toggle ? null : t.dataset.toggle; draw(); }
  });
  draw();
  search.focus();
}
