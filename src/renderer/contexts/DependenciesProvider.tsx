import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import {
  dependencyStatusUpdatedChannel,
  type DependencyStatePayload,
} from '@shared/events/appEvents';
import { events, rpc } from '../lib/ipc';

export type DependencyState = DependencyStatePayload;

type DependencyCategory = 'core' | 'agent';

type DependenciesContextValue = {
  /** All dependency states keyed by id. */
  allStatuses: Record<string, DependencyState>;
  /** Only agent dependencies. */
  agentStatuses: Record<string, DependencyState>;
  /** IDs of agents whose status is 'available'. */
  installedAgents: string[];
  getStatus: (id: string) => DependencyState | undefined;
  install: (id: string) => Promise<DependencyState>;
  probeAll: () => Promise<void>;
};

const DependenciesContext = createContext<DependenciesContextValue | null>(null);

const QUERY_KEY = ['dependencies'] as const;

// Agent provider IDs (any id that is not a core dependency)
const CORE_IDS = new Set(['git', 'gh', 'tmux', 'ssh', 'node']);

function isAgentId(id: string): boolean {
  return !CORE_IDS.has(id);
}

export function DependenciesProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: allStatuses = {} } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<Record<string, DependencyState>> => {
      const result = await rpc.dependencies.getAll();
      return (result ?? {}) as Record<string, DependencyState>;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Subscribe to live probe events and push into query cache
  React.useEffect(() => {
    const off = events.on(dependencyStatusUpdatedChannel, ({ id, state }) => {
      queryClient.setQueryData(QUERY_KEY, (prev: Record<string, DependencyState> = {}) => ({
        ...prev,
        [id]: state,
      }));
    });
    return off;
  }, [queryClient]);

  const agentStatuses = React.useMemo(
    () => Object.fromEntries(Object.entries(allStatuses).filter(([id]) => isAgentId(id))),
    [allStatuses]
  );

  const installedAgents = React.useMemo(
    () =>
      Object.entries(agentStatuses)
        .filter(([, s]) => s.status === 'available')
        .map(([id]) => id),
    [agentStatuses]
  );

  const getStatus = useCallback(
    (id: string): DependencyState | undefined => allStatuses[id],
    [allStatuses]
  );

  const install = useCallback(
    async (id: string): Promise<DependencyState> => {
      const updated = await rpc.dependencies.install(id as any);
      queryClient.setQueryData(QUERY_KEY, (prev: Record<string, DependencyState> = {}) => ({
        ...prev,
        [id]: updated,
      }));
      return updated;
    },
    [queryClient]
  );

  const probeAll = useCallback(async (): Promise<void> => {
    await rpc.dependencies.probeAll();
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  return (
    <DependenciesContext.Provider
      value={{ allStatuses, agentStatuses, installedAgents, getStatus, install, probeAll }}
    >
      {children}
    </DependenciesContext.Provider>
  );
}

export function useDependencies(): DependenciesContextValue {
  const ctx = useContext(DependenciesContext);
  if (!ctx) throw new Error('useDependencies must be used within DependenciesProvider');
  return ctx;
}

// Convenience hook for a single dependency's status
export function useDependencyStatus(id: string): DependencyState | undefined {
  const { getStatus } = useDependencies();
  return getStatus(id);
}
