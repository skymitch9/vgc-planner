/**
 * Type colours for moves. The one place that maps a type name to its CSS class (`t-fire`, coloured in
 * src/styles/builder.css), shared by the type chip and by every move name the app shows.
 */
import { currentDex } from '../infra/dex-loader.ts';
import { esc } from './dom.ts';

/** The 18 types a move can have. */
export const MOVE_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying',
  'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

/** Lower-cased type name → its proper name. Stellar has a colour too (a Tera type, never a move's own). */
const KNOWN: ReadonlyMap<string, string> = new Map([...MOVE_TYPES, 'Stellar'].map((t) => [t.toLowerCase(), t]));

/** "fire" / "Fire" → "Fire"; null for anything that isn't a type. */
export const typeName = (type: string | null | undefined): string | null => KNOWN.get(String(type ?? '').trim().toLowerCase()) ?? null;

/** The CSS class carrying a type's colour, or `t-none` for anything that isn't a type. */
export const typeClass = (type: string | null | undefined): string => {
  const name = typeName(type);
  return name ? `t-${name.toLowerCase()}` : 't-none';
};

/** The solid type badge ("FIRE"). */
export const typeChip = (type: string): string => `<span class="type ${typeClass(type)}">${esc(type)}</span>`;

/** Finds a move's type by name; null or '' when it doesn't know the move. */
export type TypeLookup = (move: string) => string | null | undefined;

/** Where a move's type is looked up, in order: the Reg M-C data once loaded, then whatever is registered. */
const sources: TypeLookup[] = [(move) => currentDex()?.move(move)?.type];

/** Adds a fallback source (the damage calculator's move data, for moves the Reg M-C data doesn't list). */
export const addMoveTypeSource = (lookup: TypeLookup): void => { sources.push(lookup); };

/** A move's type ("Fire"), or null when the move is unknown or no data has loaded yet. */
export function moveType(move: string, lookup?: TypeLookup): string | null {
  if (!move) return null;
  for (const source of lookup ? [lookup] : sources) {
    const type = typeName(source(move));
    if (type) return type;
  }
  return null;
}

export interface MoveLabelOptions {
  /** The move's type when the caller already has it (skips the lookup). */
  type?: string | null;
  /** Text to show instead of the name (a message naming the move, with Pokémon names rewritten). */
  text?: string;
  /** Replaces the default lookup. */
  lookup?: TypeLookup;
}

/**
 * A move name in its type's colour: `<span class="mvl t-fire" title="Fire">Flamethrower</span>` (a coloured bar and a
 * light tint; the text keeps the colour around it). The title names the type, so colour is never the only signal.
 * An unknown move, or one named before the data has loaded, comes back as plain escaped text.
 */
export function moveLabel(move: string, opts: MoveLabelOptions = {}): string {
  const text = esc(opts.text ?? move);
  const type = opts.type !== undefined ? typeName(opts.type) : moveType(move, opts.lookup);
  return type ? `<span class="mvl ${typeClass(type)}" title="${esc(type)}">${text}</span>` : text;
}

/** The type badge of a chosen move (beside a move `<select>`, whose options can't hold markup); '' when unknown. */
export function moveTypeChip(move: string, lookup?: TypeLookup): string {
  const type = moveType(move, lookup);
  return type ? typeChip(type) : '';
}
