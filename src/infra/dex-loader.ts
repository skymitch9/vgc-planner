import type { Dex, DexData, UsageData } from '../domain/dex.ts';

let loaded: Dex | null = null;
let pending: Promise<Dex> | null = null;

/** The legality and usage data, once loaded (null before). */
export const currentDex = (): Dex | null => loaded;

/**
 * Loads the Reg M-C legality data and usage stats. Dynamic imports keep them (about 500 KB) in their own chunks,
 * downloaded the first time a team is shown rather than with the app.
 */
export function loadDex(): Promise<Dex> {
  pending ??= Promise.all([
    import('../data/champions-mc.json'),
    import('../data/usage-mc.json'),
    import('../domain/dex.ts'),
  ]).then(([data, usage, mod]) => {
    loaded = new mod.Dex(data.default as unknown as DexData, usage.default as unknown as UsageData);
    return loaded;
  });
  pending.catch(() => { pending = null; });
  return pending;
}
