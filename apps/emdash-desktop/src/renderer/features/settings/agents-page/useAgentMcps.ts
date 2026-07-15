import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { useQuery } from '@tanstack/react-query';
import { getAgentConfigRuntimeClient } from '@renderer/lib/agent-config/runtime-client';

export function useAgentMcps(agentId: string): { servers: McpServer[]; isLoading: boolean } {
  const { data: servers = [], isPending: isLoading } = useQuery({
    queryKey: ['mcp', 'agent', agentId],
    queryFn: async () => {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.listMcpForAgent({ providerId: agentId });
      if (result.success) return result.data;
      throw new Error(agentConfigErrorMessage(result.error));
    },
  });
  return { servers, isLoading };
}

function agentConfigErrorMessage(error: { type: string; message?: string; providerId?: string }) {
  return error.message ?? (error.providerId ? `Unknown provider: ${error.providerId}` : error.type);
}
