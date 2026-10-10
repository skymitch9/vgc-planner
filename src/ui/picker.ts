/**
 * A Showdown-style search box: type to filter a list, pick with the mouse or arrows + Enter. Only listed options
 * can be chosen; leaving the box without picking puts the previous value back. That is how the team builder keeps
 * every Pokémon legal: the lists only ever contain what the regulation allows.
 */
import { esc } from './dom.ts';

export interface PickOption {
  value: string;
  /** Trusted HTML for the row, built with esc(). */
  html: string;
  /** Lowercase text the filter matches against. */
  search: string;
  /** Section heading shown above the first option that has it ("Popular", "All moves"). */
  group?: string;
}

export interface PickerOptions {
  options: () => PickOption[];
  onPick: (value: string) => void;
  /** Allows clearing the field (an empty item slot, an empty move). */
  allowEmpty?: boolean;
  /** Header row shown above the list (column titles). */
  header?: string;
}

const MAX_ROWS = 80;
let openList: HTMLElement | null = null;

function closeList(): void {
  openList?.remove();
  openList = null;
}

export function attachPicker(input: HTMLInputElement, opts: PickerOptions): void {
  let committed = input.value;
  let active = 0;
  let shown: PickOption[] = [];

  const position = (list: HTMLElement): void => {
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8))}px`;
    list.style.minWidth = `${r.width}px`;
    if (below < 260 && r.top > below) { list.style.bottom = `${window.innerHeight - r.top + 4}px`; list.style.top = ''; }
    else { list.style.top = `${r.bottom + 4}px`; list.style.bottom = ''; }
  };

  const draw = (): void => {
    const q = input.value.trim().toLowerCase();
    const all = opts.options();
    const exact = q && all.some((o) => o.value.toLowerCase() === q);
    // Right after focusing, the box holds the current value: show everything rather than just that one.
    const filtered = !q || (exact && input.value === committed) ? all : all.filter((o) => o.search.includes(q));
    shown = filtered.slice(0, MAX_ROWS);
    active = Math.max(0, Math.min(active, shown.length - 1));
    let list = openList;
    if (!list) {
      closeList();
      list = document.createElement('div');
      list.className = 'pick-list';
      list.setAttribute('role', 'listbox');
      document.body.appendChild(list);
      openList = list;
      // mousedown, not click: picking must happen before the input loses focus.
      list.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (row) pick(Number(row.dataset.i));
      });
    }
    let lastGroup: string | undefined;
    list.innerHTML = (opts.header ? `<div class="pick-head">${opts.header}</div>` : '') +
      (opts.allowEmpty && !q ? `<div class="pick-row muted" data-i="-1" role="option">(none)</div>` : '') +
      shown.map((o, i) => {
        const group = o.group && o.group !== lastGroup ? `<div class="pick-group">${esc(o.group)}</div>` : '';
        lastGroup = o.group ?? lastGroup;
        return `${group}<div class="pick-row${i === active ? ' active' : ''}" data-i="${i}" role="option">${o.html}</div>`;
      }).join('') +
      (filtered.length > shown.length ? `<div class="pick-more">${filtered.length - shown.length} more: keep typing</div>` : '') +
      (!filtered.length ? `<div class="pick-more">Nothing allowed matches “${esc(input.value)}”</div>` : '');
    position(list);
    list.querySelector('.pick-row.active')?.scrollIntoView({ block: 'nearest' });
  };

  const pick = (i: number): void => {
    const value = i < 0 ? '' : shown[i]?.value;
    if (value === undefined) return;
    committed = value;
    input.value = value;
    closeList();
    input.blur();
    opts.onPick(value);
  };

  input.addEventListener('focus', () => { active = 0; input.select(); draw(); });
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('blur', () => {
    // Anything typed but not picked is thrown away, so only allowed values ever stick.
    if (input.value !== committed) input.value = committed;
    closeList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!openList) return draw();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown.length) pick(active);
      else if (opts.allowEmpty && !input.value.trim()) pick(-1);
    } else if (e.key === 'Escape') {
      input.value = committed;
      input.blur();
    } else if (e.key === 'Tab' && openList && shown.length && input.value !== committed && input.value.trim()) {
      pick(active);
    }
  });
}

window.addEventListener('resize', closeList);
document.addEventListener('scroll', (e) => { if (openList && !openList.contains(e.target as Node)) closeList(); }, true);
