/**
 * Merging a library another tab saved into the one this tab holds, record by record (a team's own fields, each
 * gameplan, and the order of teams and of each team's gameplans), so neither tab's changes are lost.
 *
 * The rule, per record, comparing against `base` (what this tab last loaded or saved):
 *  - changed here since then (new, edited or deleted): this tab's version wins;
 *  - untouched here: the stored version wins (including its deletion);
 *  - an edit beats a deletion either way: a record edited here but deleted in storage is kept, and so is a record
 *    deleted here but edited in storage. A team that is gone is kept anyway while one of its gameplans is kept.
 * Record ids are random UUIDs, so the same id on both sides is the same record.
 */
import type { Library, Plan, Team } from './types.ts';

/** What one tab last loaded or saved, as each record's JSON (to spot what changed since). */
export interface LibraryBase {
  teams: Map<string, string>;
  plans: Map<string, string>;
  teamOrder: string;
  planOrder: Map<string, string>;
}

export interface ReconcileResult {
  library: Library;
  /** The result differs from what this tab held: something came from storage (redraw, tell the user). */
  changed: boolean;
  /** The result differs from what is stored: this tab's changes still need saving. */
  unsaved: boolean;
}

const teamJson = (team: Team): string => JSON.stringify([team.name, team.paste, team.estimatedSpreads ?? []]);
const planJson = (plan: Plan, teamId: string): string => JSON.stringify([teamId, plan.name, plan.opponent, plan.tabs]);
const orderJson = (ids: readonly string[]): string => JSON.stringify(ids);

export function snapshotLibrary(library: Library): LibraryBase {
  const base: LibraryBase = { teams: new Map(), plans: new Map(), teamOrder: orderJson(library.teams.map((t) => t.id)), planOrder: new Map() };
  for (const team of library.teams) {
    base.teams.set(team.id, teamJson(team));
    base.planOrder.set(team.id, orderJson(team.plans.map((p) => p.id)));
    for (const plan of team.plans) base.plans.set(plan.id, planJson(plan, team.id));
  }
  return base;
}

/** Is the whole library the same in both (every record and both orders)? */
function sameLibrary(a: LibraryBase, b: LibraryBase): boolean {
  const sameMap = (x: Map<string, string>, y: Map<string, string>): boolean => x.size === y.size && [...x].every(([k, v]) => y.get(k) === v);
  return a.teamOrder === b.teamOrder && sameMap(a.teams, b.teams) && sameMap(a.plans, b.plans) && sameMap(a.planOrder, b.planOrder);
}

/** Which side's record survives (undefined: dropped). `local` / `stored` are the JSON of each side's record, if it has one. */
function pick<T>(base: string | undefined, local: { json: string; value: T } | undefined, stored: { json: string; value: T } | undefined): T | undefined {
  if (local && stored) return local.json !== base ? local.value : stored.value;
  if (local) return base === undefined || local.json !== base ? local.value : undefined;
  if (stored) return base === undefined || stored.json !== base ? stored.value : undefined;
  return undefined;
}

/**
 * The survivors in order. If this tab moved records around since `base` (the records both orders share are in a
 * different order), its order wins, otherwise the stored one does. A survivor missing from the winning order goes
 * right after the record it follows in the other one.
 */
function order(base: string | undefined, local: readonly string[], stored: readonly string[], keep: ReadonlySet<string>): string[] {
  const before = base === undefined ? [] : (JSON.parse(base) as string[]);
  const shared = (ids: readonly string[], other: readonly string[]): string => orderJson(ids.filter((id) => other.includes(id)));
  const moved = shared(local, before) !== shared(before, local);
  const [first, second] = moved ? [local, stored] : [stored, local];
  const out = first.filter((id) => keep.has(id));
  second.forEach((id, i) => {
    if (!keep.has(id) || out.includes(id)) return;
    const after = second.slice(0, i).reverse().find((prev) => out.includes(prev));
    out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id);
  });
  return out;
}

/**
 * Merges `stored` into `local` by the rule above. `local` is updated in place (a record that takes the stored version
 * keeps its object, with the stored contents copied in), so anything holding one of its teams or gameplans, like an
 * open dialog, still edits the library; the result's `library` is `local`.
 */
export function reconcileLibrary(base: LibraryBase, local: Library, stored: Library): ReconcileResult {
  type Located = { plan: Plan; teamId: string };
  const before = snapshotLibrary(local);
  const plansOf = (lib: Library): Map<string, Located> =>
    new Map(lib.teams.flatMap((team) => team.plans.map((plan) => [plan.id, { plan, teamId: team.id }] as const)));
  const localTeams = new Map(local.teams.map((t) => [t.id, t]));
  const storedTeams = new Map(stored.teams.map((t) => [t.id, t]));
  const localPlans = plansOf(local);
  const storedPlans = plansOf(stored);
  const located = (l: Located | undefined) => (l ? { json: planJson(l.plan, l.teamId), value: l } : undefined);

  const plans = new Map<string, Located>();
  for (const id of new Set([...localPlans.keys(), ...storedPlans.keys()])) {
    const kept = pick(base.plans.get(id), located(localPlans.get(id)), located(storedPlans.get(id)));
    if (!kept) continue;
    const mine = localPlans.get(id)?.plan;
    if (mine && mine !== kept.plan) Object.assign(mine, { name: kept.plan.name, opponent: kept.plan.opponent, tabs: kept.plan.tabs });
    plans.set(id, { plan: mine ?? kept.plan, teamId: kept.teamId });
  }
  const teams = new Map<string, Team>();
  for (const id of new Set([...localTeams.keys(), ...storedTeams.keys()])) {
    const l = localTeams.get(id);
    const s = storedTeams.get(id);
    const kept = pick(base.teams.get(id), l && { json: teamJson(l), value: l }, s && { json: teamJson(s), value: s })
      ?? ([...plans.values()].some((p) => p.teamId === id) ? (l ?? s) : undefined);
    if (!kept) continue;
    if (l && l !== kept) {
      l.name = kept.name;
      l.paste = kept.paste;
      if (kept.estimatedSpreads) l.estimatedSpreads = [...kept.estimatedSpreads]; else delete l.estimatedSpreads;
    }
    teams.set(id, l ?? kept);
  }

  const teamIds = order(base.teamOrder, local.teams.map((t) => t.id), stored.teams.map((t) => t.id), new Set(teams.keys()));
  const merged = teamIds.map((id) => {
    const team = teams.get(id)!;
    const own = new Set([...plans].filter(([, p]) => p.teamId === id).map(([planId]) => planId));
    const planIds = order(base.planOrder.get(id), localTeams.get(id)?.plans.map((p) => p.id) ?? [], storedTeams.get(id)?.plans.map((p) => p.id) ?? [], own);
    team.plans.splice(0, team.plans.length, ...planIds.map((planId) => plans.get(planId)!.plan));
    return team;
  });
  local.teams.splice(0, local.teams.length, ...merged);
  const result = snapshotLibrary(local);
  return { library: local, changed: !sameLibrary(result, before), unsaved: !sameLibrary(result, snapshotLibrary(stored)) };
}
