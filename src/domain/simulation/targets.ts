import { TARGET_KEYWORDS } from '../types.ts';

/** Who can be picked as a move's target: the foes on the field and the user's partner(s), never the user itself. */
export interface TargetContext {
  foes: readonly string[];
  allies: readonly string[];
}

/** Which side a Pokémon named as a target is on, seen from the move's user. Ignored for keywords. */
export type TargetWho = 'foe' | 'ally' | 'self';

const [BOTH_FOES, ALLY, SELF, ALL] = TARGET_KEYWORDS;
/** Stand-in names for checking a keyword against a target type (no Pokémon can be called this). */
const PROBE_FOE = '#foe';
const PROBE_ALLY = '#ally';

/**
 * The only target choices the turn editor may offer for a move, in display order, from the move's Showdown target
 * type (`MoveInfo.target`). Each choice is something `resolveTargets` in turn.ts can execute: a foe or ally by name,
 * or one of the {@link TARGET_KEYWORDS}. Spread moves are spread by their target type in the simulation whatever is
 * picked, so they get one fixed keyword; moves the simulation handles by name (Protect, Tailwind, Trick Room...)
 * never read the target, so they get the one keyword that describes them. An unknown or empty target type (no move
 * data) gives the old permissive list, so nothing regresses.
 */
export function legalTargets(moveTarget: string, ctx: TargetContext): string[] {
  const foes = [...ctx.foes];
  const allies = [...ctx.allies];
  switch (moveTarget) {
    // One adjacent Pokémon, foe or partner: U-turn, Fake Out, Pollen Puff, After You. `any` also reaches
    // non-adjacent ones in triples, which doubles doesn't have: Brave Bird, Dark Pulse.
    case 'normal':
    case 'any':
      return [...foes, ...allies];
    // Foes only. adjacentFoe: Me First. randomNormal: Outrage / Petal Dance / Thrash hit a random foe, and the editor
    // records which one (the simulation needs a name and won't pick at random); they never hit the partner.
    // scripted: Counter, Mirror Coat, Metal Burst, Comeuppance hit back at whoever hit them; the simulation ignores
    // the target and finds the attacker itself, so a foe is the only sensible thing to record.
    case 'adjacentFoe':
    case 'randomNormal':
    case 'scripted':
      return foes;
    // Both foes at once: Heat Wave, Rock Slide, Icy Wind, Dazzling Gleam.
    case 'allAdjacentFoes':
      return [BOTH_FOES];
    // Both foes and the partner: Earthquake, Discharge, Surf, Explosion.
    case 'allAdjacent':
      return [ALL];
    // The user: Protect, Swords Dance, Substitute (self). The user's side: Tailwind, Reflect, Wide Guard (allySide);
    // Heal Bell (allyTeam); Howl, Life Dew (allies). The simulation applies the side-wide ones by move, so 'Self'
    // only marks "nothing to choose".
    case 'self':
    case 'allySide':
    case 'allyTeam':
    case 'allies':
      return [SELF];
    // The partner only: Helping Hand, Coaching, Aromatic Mist. With no partner known, the 'Ally' keyword.
    case 'adjacentAlly':
      return allies.length ? allies : [ALLY];
    // The user or its partner: Acupressure (and Milk Drink in this format's data).
    case 'adjacentAllyOrSelf':
      return [SELF, ...allies];
    // The foes' side of the field: Stealth Rock, Spikes, Sticky Web.
    case 'foeSide':
      return [BOTH_FOES];
    // The whole field: Trick Room, weather and terrain moves, Haze, Gravity, Perish Song.
    case 'all':
      return [ALL];
    // Unknown target type, or no move data: everything, as before.
    default:
      return [...new Set([...foes, BOTH_FOES, ...allies, ALLY, SELF, ALL])];
  }
}

/**
 * Whether `target` is an allowed choice for a move of this target type, whether or not that Pokémon is still on the
 * field (a chosen foe that switched out stays legal: the move hits whoever took its place). `who` says which side a
 * Pokémon name is on. An empty target is always allowed (nothing picked yet).
 */
export function isLegalTarget(moveTarget: string, target: string, who: TargetWho): boolean {
  if (!target) return true;
  if ((TARGET_KEYWORDS as readonly string[]).includes(target)) {
    const probe = legalTargets(moveTarget, { foes: [PROBE_FOE], allies: [PROBE_ALLY] });
    // 'Ally' means "my partner", so it is fine wherever the partner could be picked by name.
    return probe.includes(target) || (target === ALLY && probe.includes(PROBE_ALLY));
  }
  if (who === 'self') return false;
  return legalTargets(moveTarget, who === 'foe' ? { foes: [target], allies: [] } : { foes: [], allies: [target] }).includes(target);
}
