import { useQuery } from '@tanstack/react-query';
import { DependencyState } from '@main/core/dependencies/types';
import { rpc } from '@renderer/core/ipc';

export function useRemoteInstalledAgents(connectionId?: string) {
  return useQuery({
    queryKey: ['dependencies', 'remote', connectionId],
    queryFn: async () => {
      await rpc.dependencies.probeCategory('agent', connectionId!);
      const all = await rpc.dependencies.getAll(connectionId!);
      return Object.entries(all)
        .filter(([, s]) => (s as DependencyState).status === 'available')
        .map(([id]) => id);
    },
    enabled: !!connectionId,
    staleTime: 5 * 60_000,
  });
}
