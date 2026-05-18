import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { mcpServerStatusChannel, type McpServerStatus } from '@shared/events/mcpServerEvents';
import { events, rpc } from '@renderer/lib/ipc';

const QUERY_KEY = ['mcpServer', 'status'] as const;

/**
 * Live status of the in-process emdash MCP HTTP server.
 *
 * Initial value is fetched via `mcpServer.getStatus` (React Query); thereafter
 * the cache is patched in-place whenever the main process emits on
 * `mcpServerStatusChannel`, so the Settings page reflects start/stop/port
 * changes without polling.
 */
export function useMcpServerStatus() {
  const queryClient = useQueryClient();

  const query = useQuery<McpServerStatus | null>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.mcpServer.getStatus();
      return result.success ? result.data : null;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const unsubscribe = events.on(mcpServerStatusChannel, (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
    });
    return unsubscribe;
  }, [queryClient]);

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
