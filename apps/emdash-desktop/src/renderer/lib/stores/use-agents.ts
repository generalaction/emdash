import { useQuery } from '@tanstack/react-query';
import type { AgentMetadata, AgentPayload } from '@core/primitives/agents/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export const AGENTS_METADATA_QUERY_KEY = ['agents', 'metadata'] as const;

/**
 * Fetches static agent metadata (name, description, icon, capabilities) for all agents.
 * This is host-independent and can be used without a connectionId.
 */
export function useAgents() {
  return useQuery<AgentPayload[]>({
    queryKey: AGENTS_METADATA_QUERY_KEY,
    queryFn: async () => (await getDesktopWireClient()).agents.list({}),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches metadata for a single agent.
 */
export function useAgent(id: string, connectionId?: string) {
  return useQuery<AgentPayload | null>({
    queryKey: [...AGENTS_METADATA_QUERY_KEY, id, connectionId ?? 'local'],
    queryFn: async () => (await getDesktopWireClient()).agents.get({ id }),
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
