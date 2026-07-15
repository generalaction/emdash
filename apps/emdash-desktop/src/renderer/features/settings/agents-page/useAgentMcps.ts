import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAgentConfigRuntimeClient } from '@renderer/lib/agent-config/runtime-client';
import { useToast } from '@renderer/lib/hooks/use-toast';

export function useAgentMcps(agentId: string): {
  servers: McpServer[];
  isLoading: boolean;
  removeServer: (name: string) => void;
  removingServerName: string | null;
} {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: servers = [], isPending: isLoading } = useQuery({
    queryKey: ['mcp', 'agent', agentId],
    queryFn: async () => {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.listMcpForAgent({ providerId: agentId });
      if (result.success) return result.data;
      throw new Error(agentConfigErrorMessage(result.error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (name: string) => {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.removeMcpForAgent({ providerId: agentId, name });
      if (!result.success) throw new Error(agentConfigErrorMessage(result.error));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mcp', 'agent', agentId] });
    },
    onError: (error) => {
      toast({
        title: 'Failed to remove MCP server',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    servers,
    isLoading,
    removeServer: (name) => removeMutation.mutate(name),
    removingServerName: removeMutation.isPending ? (removeMutation.variables ?? null) : null,
  };
}

function agentConfigErrorMessage(error: { type: string; message?: string; providerId?: string }) {
  return error.message ?? (error.providerId ? `Unknown provider: ${error.providerId}` : error.type);
}
