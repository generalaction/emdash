import { isValidProviderId, type ProviderId } from './providers/registry';

export const MAX_AGENT_RUNS = 4;

export type NormalizedAgentRun = { agent: ProviderId; runs: number };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

export function normalizeAgentRuns(
  value: unknown,
  fallbackAgent: ProviderId
): NormalizedAgentRun[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<ProviderId>();
  const normalized: NormalizedAgentRun[] = [];

  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    const agent = record.agent;
    if (!isValidProviderId(agent) || seen.has(agent)) continue;

    const rawRuns = Number(record.runs);
    const rounded = Number.isFinite(rawRuns) ? Math.round(rawRuns) : 1;
    const runs = Math.max(1, Math.min(MAX_AGENT_RUNS, rounded));

    normalized.push({ agent, runs });
    seen.add(agent);
  }

  if (!normalized.length) {
    normalized.push({ agent: fallbackAgent, runs: 1 });
  }

  return normalized;
}
