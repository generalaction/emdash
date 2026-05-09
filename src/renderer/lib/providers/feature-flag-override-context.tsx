import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { rpc } from '@renderer/lib/ipc';

const FeatureFlagContext = createContext<Record<string, boolean>>({});

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const { data: flags = {} } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: () => rpc.telemetry.getFeatureFlags(),
    staleTime: Infinity,
    refetchInterval: (query) => {
      const data = query.state.data;
      return !data || Object.keys(data).length === 0 ? 2_000 : false;
    },
  });
  return <FeatureFlagContext value={flags}>{children}</FeatureFlagContext>;
}

export function useFeatureFlags(): Record<string, boolean> {
  return useContext(FeatureFlagContext);
}
