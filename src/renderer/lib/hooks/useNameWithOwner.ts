import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export function useNameWithOwner(projectId: string | undefined) {
  return useQuery({
    queryKey: ['nameWithOwner', projectId],
    queryFn: async () => {
      if (!projectId) return { status: 'no_remote' as const };
      return rpc.pullRequests.getNameWithOwner(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
