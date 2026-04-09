import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export function useDefaultBranch(projectId: string) {
  const { data: defaultBranch, isLoading } = useQuery({
    queryKey: ['default-branch', projectId],
    queryFn: async () => await rpc.repository.getDefaultBranch(projectId),
    staleTime: 60_000,
  });
  return { defaultBranch, isLoading };
}
