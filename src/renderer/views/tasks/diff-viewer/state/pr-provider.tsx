import { createContext, ReactNode, useContext } from 'react';
import { GitChange } from '@shared/git';
import { PullRequest } from '@shared/pull-requests';

type MergeMode = 'merge' | 'squash' | 'rebase';
type MergeResult = { success: true } | { success: false; error: string };

interface PrContextValue {
  pullRequests: PullRequest[];
  files: Record<string, GitChange[]>;
  mergePr: (
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ) => Promise<MergeResult>;
  refreshPullRequest: (id: string) => void;
}

const PrContext = createContext<PrContextValue | null>(null);

export function PrProvider({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  return (
    <PrContext.Provider
      value={{
        pullRequests: [],
        files: {},
        mergePr: async () => ({ success: true }),
        refreshPullRequest: () => {},
      }}
    >
      {children}
    </PrContext.Provider>
  );
}

export function usePrContext(): PrContextValue {
  const ctx = useContext(PrContext);
  if (!ctx) throw new Error('usePrContext must be used within a PrProvider');
  return ctx;
}
