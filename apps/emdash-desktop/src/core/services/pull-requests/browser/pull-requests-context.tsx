import * as React from 'react';
import type { PullRequestsStore } from './pull-requests-store';

const PullRequestsStoreContext = React.createContext<PullRequestsStore | null>(null);

export function PullRequestsStoreProvider({
  store,
  children,
}: {
  store: PullRequestsStore;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <PullRequestsStoreContext.Provider value={store}>{children}</PullRequestsStoreContext.Provider>
  );
}

export function usePullRequestsStore(override?: PullRequestsStore): PullRequestsStore {
  const context = React.useContext(PullRequestsStoreContext);
  const store = override ?? context;
  if (!store) {
    throw new Error('usePullRequestsStore must be used inside PullRequestsStoreProvider');
  }
  return store;
}
