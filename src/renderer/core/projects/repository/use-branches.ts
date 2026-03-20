import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/core/ipc';

export function useBranches(projectId: string) {
  const { data: branches = [] } = useQuery({
    queryKey: ['repository', 'branches', projectId],
    queryFn: () => rpc.repository.getBranches(projectId),
  });
  return { branches };
}
