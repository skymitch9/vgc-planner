/**
 * Shrinks a Smogon "chaos" usage file (several MB) to what the app needs: per Pokémon its usage and the most used
 * abilities, items, moves, spreads and teammates, as percentages of that Pokémon's own games.
 *
 * Pure and dependency free on purpose: scripts/fetch-usage.mjs runs it in Node, and the same source can run in a
 * browser tab when Smogon is only reachable from there.
 */
export function reduceChaos(chaos, { minUsage = 0.001, maxMons = 150 } = {}) {
  /** `base`: what 100% means. Abilities, items and spreads sum to the Pokémon's games; moves sum to about 4x that. */
  const top = (table, n, base) => {
    const entries = Object.entries(table ?? {});
    const total = base ?? (entries.reduce((a, [, w]) => a + w, 0) || 1);
    return entries
      .filter(([k]) => k && k !== 'nothing' && k !== '')
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, w]) => [k, Math.round((w / total) * 1000) / 10])
      .filter(([, pct]) => pct >= 0.5);
  };
  const mons = Object.entries(chaos.data)
    .filter(([, d]) => d.usage >= minUsage)
    .sort((a, b) => b[1].usage - a[1].usage)
    .slice(0, maxMons)
    .map(([name, d]) => {
      // Teammate weights are relative to this Pokémon's games, like the rest, so use its ability total as the base.
      const games = Object.values(d.Abilities ?? {}).reduce((a, w) => a + w, 0) || 1;
      const mates = Object.entries(d.Teammates ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, w]) => [k, Math.round((w / games) * 1000) / 10])
        .filter(([, pct]) => pct >= 1);
      return {
        name,
        usage: Math.round(d.usage * 10000) / 100,
        abilities: top(d.Abilities, 4, games),
        items: top(d.Items, 8, games),
        moves: top(d.Moves, 14, games),
        spreads: top(d.Spreads, 6, games).map(([k, pct]) => {
          const [nature, sp] = k.split(':');
          return [nature, sp, pct];
        }),
        mates,
      };
    });
  return {
    cutoff: chaos.info.cutoff,
    battles: chaos.info['number of battles'],
    mons,
  };
}
