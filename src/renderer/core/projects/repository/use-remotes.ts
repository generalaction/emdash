import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/core/ipc';

export function useRemotes(projectId: string) {
  const { data: remotes = [] } = useQuery({
    queryKey: ['repository', 'remotes', projectId],
    queryFn: () => rpc.repository.getRemotes(projectId),
  });
  return { remotes };
}
