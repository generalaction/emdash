import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { AgentMetadata, AgentPayload } from '@shared/core/agents/agent-payload';

export const AGENTS_METADATA_QUERY_KEY = ['agents', 'metadata'] as const;

/**
 * Fetches static agent metadata (name, description, icon, capabilities) for all agents.
 * This is host-independent and can be used without a connectionId.
 */
export function useAgents() {
  return useQuery<AgentPayload[]>({
    queryKey: AGENTS_METADATA_QUERY_KEY,
    queryFn: () => rpc.agents.list() as Promise<AgentPayload[]>,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches metadata for a single agent.
 */
export function useAgent(id: string, connectionId?: string) {
  return useQuery<AgentPayload | null>({
    queryKey: [...AGENTS_METADATA_QUERY_KEY, id, connectionId ?? 'local'],
    queryFn: () => rpc.agents.get(id, connectionId) as Promise<AgentPayload | null>,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Returns agent metadata for use in icon rendering.
 * Reads from the shared agents cache so there is no extra fetch.
 */
export function useAgentIcon(id: string) {
  const { data: agents } = useAgents();
  const agent = agents?.find((a) => a.id === id);
  return (agent as AgentMetadata | undefined)?.icon ?? null;
}
