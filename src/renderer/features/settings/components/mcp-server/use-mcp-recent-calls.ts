import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { mcpServerRecentCallChannel, type RecentCallEntry } from '@shared/events/mcpServerEvents';
import { events, rpc } from '@renderer/lib/ipc';

const QUERY_KEY = ['mcpServer', 'recentCalls'] as const;

/**
 * Live-updating ring buffer of recent MCP tool invocations.
 *
 * Hydrates from `mcpServer.getRecentCalls` (most-recent first, capped to
 * `limit`) and then unshifts entries as the main process publishes them on
 * `mcpServerRecentCallChannel`.
 */
export function useMcpRecentCalls(limit = 20) {
  const queryClient = useQueryClient();

  const query = useQuery<RecentCallEntry[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.mcpServer.getRecentCalls({ limit });
      return result.success ? result.data : [];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const unsubscribe = events.on(mcpServerRecentCallChannel, (entry) => {
      queryClient.setQueryData<RecentCallEntry[]>(QUERY_KEY, (prev) => {
        const next = [entry, ...(prev ?? [])];
        return next.slice(0, limit);
      });
    });
    return unsubscribe;
  }, [queryClient, limit]);

  return {
    calls: query.data ?? [],
    isLoading: query.isLoading,
  };
}
