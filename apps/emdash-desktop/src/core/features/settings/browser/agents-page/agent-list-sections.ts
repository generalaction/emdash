import type { AgentPayload } from '@core/primitives/agents/api';

const RECOMMENDED_IDS = new Set(['claude', 'codex', 'pi']);

export type AgentListItem = Pick<AgentPayload, 'id' | 'name' | 'status'>;

export type AgentSection<T extends AgentListItem = AgentListItem> = {
  label: string;
  agents: T[];
};

export function buildAgentSections<T extends AgentListItem>(
  agents: readonly T[],
  searchQuery = ''
): AgentSection<T>[] {
  const normalizedQuery = searchQuery.toLowerCase();
  const allAgents = agents
    .filter((agent) => !normalizedQuery || agent.name.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.name.localeCompare(b.name));
  const uninstalledAgents = allAgents.filter((agent) => agent.status !== 'available');

  return [
    {
      label: 'Installed',
      agents: allAgents.filter((agent) => agent.status === 'available'),
    },
    {
      label: 'Recommended',
      agents: uninstalledAgents.filter((agent) => RECOMMENDED_IDS.has(agent.id)),
    },
    {
      label: 'Not installed',
      agents: uninstalledAgents.filter((agent) => !RECOMMENDED_IDS.has(agent.id)),
    },
  ];
}
