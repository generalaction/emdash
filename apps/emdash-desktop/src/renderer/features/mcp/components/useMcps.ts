import type { McpProvidersResponse, McpServer } from '@emdash/core/primitives/mcp/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useInstalledMcpServersLiveModel } from '@renderer/lib/agent-config/live-model-hooks';
import { getAgentConfigRuntimeClient } from '@renderer/lib/agent-config/runtime-client';
import { getCatalogRuntimeClient } from '@renderer/lib/catalog/runtime-client';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const MCP_CATALOG_QUERY_KEY = ['mcp', 'catalog'] as const;

export function useMcps() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: installed, isLoading: isLoadingInstalled } = useInstalledMcpServersLiveModel();
  const { data: agents } = useAgents();
  const { data: agentStatuses, probeAll } = useAgentInstallationStatuses();

  // ── Queries ──────────────────────────────────────────────────────────

  const {
    data: catalog = [],
    isPending: isLoadingCatalog,
    refetch: reload,
  } = useQuery({
    queryKey: MCP_CATALOG_QUERY_KEY,
    queryFn: async () => {
      const client = await getCatalogRuntimeClient();
      const result = await client.getMcpCatalog(undefined);
      if (result.success) return result.data;
      throw new Error(result.error.message);
    },
  });

  const providers = useMemo<McpProvidersResponse[]>(() => {
    const statusesById = new Map((agentStatuses ?? []).map((status) => [status.id, status]));
    return (agents ?? [])
      .filter((agent) => agent.capabilities.mcp.kind === 'supported')
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        installed: statusesById.get(agent.id)?.status === 'available',
        supportsHttp: agentSupportsHttpMcp(agent.capabilities.mcp),
      }));
  }, [agents, agentStatuses]);

  const isLoading = isLoadingCatalog || isLoadingInstalled;

  // ── Mutations ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (payload: { server: McpServer; source: 'catalog' | 'custom' | null }) => {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.saveMcpServer({ server: payload.server });
      if (!result.success) throw new Error(agentConfigErrorMessage(result.error));
    },
    onSuccess: (_, payload) => {
      if (payload.source) {
        captureTelemetry('mcp_server_added', { source: payload.source });
      }
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
      const client = await getAgentConfigRuntimeClient();
      const result = await client.removeMcpServer({ name: serverName });
      if (!result.success) throw new Error(agentConfigErrorMessage(result.error));
    },
    onSuccess: () => {
      captureTelemetry('mcp_server_removed');
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
      await new Promise<void>((resolve) => {
        probeAll(undefined, { onSettled: () => resolve() });
      });
      await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_QUERY_KEY });
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

function agentSupportsHttpMcp(mcp: { kind: string }): boolean {
  if (mcp.kind !== 'supported') return false;
  const detailed = mcp as {
    supportsHttp?: boolean;
    supportedTransports?: string[];
  };
  return detailed.supportedTransports?.includes('http') ?? detailed.supportsHttp ?? false;
}

function agentConfigErrorMessage(error: { type: string; message?: string; providerId?: string }) {
  return error.message ?? (error.providerId ? `Unknown provider: ${error.providerId}` : error.type);
}
