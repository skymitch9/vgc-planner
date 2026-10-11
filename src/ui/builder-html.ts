/** Small HTML pieces shared by the team builder and the Top builds browser. */
import type { Dex, DexItem, DexMove, DexSpecies } from '../domain/dex.ts';
import { toID } from '../domain/dex.ts';
import { esc } from './dom.ts';
import { itemIcon, monIcon } from './icons.ts';
import { typeChip } from './move-type.ts';
import type { PickOption } from './picker.ts';

export { typeChip };
const CAT: Record<string, string> = { Physical: 'Phys', Special: 'Spec', Status: 'Status' };
export const catChip = (cat: string): string => `<span class="cat c-${esc(cat.toLowerCase())}">${esc(CAT[cat] ?? cat)}</span>`;
export const pct = (n: number | undefined): string => (n === undefined ? '' : `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`);

export function speciesOptions(dex: Dex): PickOption[] {
  return dex.speciesByUsage().map((s) => {
    const use = dex.speciesUsage(s);
    return {
      value: s.name,
      search: `${s.name} ${s.types.join(' ')} ${(s.megas ?? []).map((m) => m.name).join(' ')}`.toLowerCase(),
      group: use ? 'Used in Reg M-C' : 'Everything else allowed',
      html: `${monIcon(s.name, 'xs')}<span class="pk-name">${esc(s.name)}${s.megas ? ' <span class="pk-tag">Mega</span>' : ''}</span>
        <span class="pk-types">${s.types.map(typeChip).join('')}</span>
        <span class="pk-num">${bst(s)}</span><span class="pk-use">${use ? pct(use) : ''}</span>`,
    };
  });
}

const bst = (s: DexSpecies): number => Object.values(s.baseStats).reduce((a, b) => a + b, 0);

export function moveOptions(dex: Dex, species: DexSpecies, exclude: readonly string[]): PickOption[] {
  const usage = dex.moveUsage(species);
  const taken = new Set(exclude.map(toID));
  const moves = dex.legalMoves(species).filter((m) => !taken.has(toID(m.name)));
  const popular = moves.filter((m) => usage.has(toID(m.name))).sort((a, b) => (usage.get(toID(b.name)) ?? 0) - (usage.get(toID(a.name)) ?? 0));
  const rest = moves.filter((m) => !usage.has(toID(m.name))).sort((a, b) => a.name.localeCompare(b.name));
  const row = (m: DexMove, group: string): PickOption => ({
    value: m.name,
    group,
    search: `${m.name} ${m.type} ${m.category}`.toLowerCase(),
    html: `<span class="pk-name" title="${esc(m.desc)}">${esc(m.name)}</span>${typeChip(m.type)}${catChip(m.category)}
      <span class="pk-num">${m.bp ?? '—'}</span><span class="pk-num">${m.acc ?? '—'}</span>
      <span class="pk-use">${pct(usage.get(toID(m.name)))}</span><span class="pk-desc">${esc(m.desc)}</span>`,
  });
  return [...popular.map((m) => row(m, 'Popular on this Pokémon')), ...rest.map((m) => row(m, 'Every other legal move'))];
}
export const MOVE_HEADER = '<span class="pk-name">Move</span><span>Type</span><span>Cat</span><span class="pk-num">Pow</span><span class="pk-num">Acc</span><span class="pk-use">Used</span>';

export function itemOptions(dex: Dex, species: DexSpecies | null): PickOption[] {
  const usage = new Map<string, number>();
  for (const u of dex.usageFor(species)) for (const [name, p] of u.items) usage.set(toID(name), Math.max(usage.get(toID(name)) ?? 0, p));
  const items = dex.legalItems(species);
  const sorted = [...items].sort((a, b) => (usage.get(toID(b.name)) ?? 0) - (usage.get(toID(a.name)) ?? 0) || Number(!!b.mega) - Number(!!a.mega) || a.name.localeCompare(b.name));
  return sorted.map((i: DexItem) => ({
    value: i.name,
    group: usage.has(toID(i.name)) ? 'Popular on this Pokémon' : i.mega ? 'Mega Stones' : 'Every other allowed item',
    search: i.name.toLowerCase(),
    html: `${itemIcon(i.name, 'xs')}<span class="pk-name">${esc(i.name)}</span><span class="pk-use">${pct(usage.get(toID(i.name)))}</span><span class="pk-desc">${esc(i.desc)}</span>`,
  }));
}

export const monLabel = (species: string, item: string): string =>
  `${monIcon(species, 'sm')}<span class="slot-name">${esc(species)}</span>${item ? itemIcon(item, 'xs') : ''}`;
