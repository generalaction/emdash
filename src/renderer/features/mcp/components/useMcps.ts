import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { McpCatalogEntry, McpProvidersResponse, McpServer } from '@shared/mcp/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const MCP_QUERY_KEY = ['mcp', 'all'] as const;
const PROVIDERS_QUERY_KEY = ['mcp', 'providers'] as const;

export function useMcps() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────

  const {
    data: mcpData,
    isPending: isLoading,
    refetch: reload,
  } = useQuery({
    queryKey: MCP_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.mcp.loadAll();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load MCP servers');
    },
  });

  const installed: McpServer[] = mcpData?.installed ?? [];
  const catalog: McpCatalogEntry[] = mcpData?.catalog ?? [];

  const { data: providers = [] } = useQuery({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.mcp.getProviders();
      if (result.success && result.data) return result.data as McpProvidersResponse[];
      throw new Error(result.error ?? 'Failed to get providers');
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (payload: { server: McpServer; source: 'catalog' | 'custom' | null }) => {
      const result = await rpc.mcp.saveServer(payload.server);
      if (!result.success) throw new Error(result.error ?? 'Failed to save server');
    },
    onSuccess: (_, payload) => {
      if (payload.source) {
        captureTelemetry('mcp_server_added', { source: payload.source });
      }
      void queryClient.invalidateQueries({ queryKey: MCP_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: 'Failed to save server',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const saveServer = useCallback(
    async (server: McpServer, source: 'catalog' | 'custom' | null = null) => {
      await saveMutation.mutateAsync({ server, source });
    },
    [saveMutation]
  );

  const removeMutation = useMutation({
    mutationFn: async (serverName: string) => {
      const result = await rpc.mcp.removeServer(serverName);
      if (!result.success) throw new Error(result.error ?? 'Failed to remove server');
    },
    onSuccess: () => {
      captureTelemetry('mcp_server_removed');
      void queryClient.invalidateQueries({ queryKey: MCP_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: 'Failed to remove server',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const removeServer = useCallback(
    async (serverName: string) => {
      await removeMutation.mutateAsync(serverName);
    },
    [removeMutation]
  );

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const result = await rpc.mcp.refreshProviders();
      if (result.success && result.data) return result.data as McpProvidersResponse[];
      throw new Error(result.error ?? 'Failed to refresh providers');
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PROVIDERS_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: MCP_QUERY_KEY });
    },
    onError: () => {
      toast({ title: 'Failed to refresh MCP data', variant: 'destructive' });
    },
  });

  const refresh = useCallback(() => refreshMutation.mutate(), [refreshMutation]);

  return {
    installed,
    catalog,
    providers,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    saveServer,
    removeServer,
    refresh,
    reload,
  };
}
