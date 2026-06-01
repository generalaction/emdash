import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from '@shared/usage';

const KEY = ['usage', 'snapshot'] as const;

async function fetchSnapshot(): Promise<UsageSnapshot> {
  // Handlers always return ok(...); transport/throw failures reject and surface as isError.
  const res = await rpc.usageStats.getSnapshot();
  return res.data;
}

export function useUsageSnapshot() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: fetchSnapshot, staleTime: 60_000 });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await rpc.usageStats.refresh();
      return res.data;
    },
    onSuccess: (snapshot) => queryClient.setQueryData(KEY, snapshot),
  });

  return {
    snapshot: query.data ?? EMPTY_USAGE_SNAPSHOT,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    refresh: () => refresh.mutate(),
    isRefreshing: refresh.isPending,
  };
}
