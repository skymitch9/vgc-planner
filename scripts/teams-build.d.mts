// Types for teams-build.mjs, so the TypeScript tests can import it.
import type { DexData, UsageData } from '../src/domain/dex.ts';
import type { TeamSource, TopTeamsData } from '../src/domain/teams.ts';

export const FORMAT_NAME: string;
export const SOURCE_INFO: Record<TeamSource, { label: string; url: string }>;
export function buildTeams(options: {
  load: (kind: string, key: string | number) => Promise<string | null>;
  dexData: DexData;
  usageData?: UsageData | null;
  sources?: TeamSource[];
  limit?: number;
  today: string;
  log?: (line: string) => void;
  crobCapBytes?: number;
}): Promise<{ data: TopTeamsData; skipped: { id: string; reason: string }[]; notes: { id: string; note: string }[] }>;
