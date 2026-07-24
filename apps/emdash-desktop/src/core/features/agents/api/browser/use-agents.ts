import { hostRefKey, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { useQuery } from '@tanstack/react-query';
import { getAgentsClient, unwrapAgentsResult } from '@core/features/agents/api/browser/client';
import type { AgentMetadata, AgentPayload } from '@core/primitives/agents/api';

export const AGENTS_METADATA_QUERY_KEY = ['agents', 'metadata'] as const;

export function useAgents(host: HostRef = LOCAL_HOST_REF) {
  return useQuery<AgentPayload[], RuntimeResolveError>({
    queryKey: [...AGENTS_METADATA_QUERY_KEY, hostRefKey(host)],
    queryFn: async () => unwrapAgentsResult((await getAgentsClient()).list({ host })),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgent(id: string, host: HostRef = LOCAL_HOST_REF) {
  return useQuery<AgentPayload | null, RuntimeResolveError>({
    queryKey: [...AGENTS_METADATA_QUERY_KEY, hostRefKey(host), id],
    queryFn: async () => unwrapAgentsResult((await getAgentsClient()).get({ host, id })),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgentIcon(id: string) {
  const { data: agents } = useAgents();
  const agent = agents?.find((candidate) => candidate.id === id);
  return (agent as AgentMetadata | undefined)?.icon ?? null;
}
