import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { McpServer } from '@shared/core/mcp/types';

export function useAgentMcps(agentId: string): { servers: McpServer[]; isLoading: boolean } {
  const { data: servers = [], isPending: isLoading } = useQuery({
    queryKey: ['mcp', 'agent', agentId],
    queryFn: async () => {
      const result = await rpc.mcp.listForAgent(agentId);
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load MCP servers');
    },
  });
  return { servers, isLoading };
}
