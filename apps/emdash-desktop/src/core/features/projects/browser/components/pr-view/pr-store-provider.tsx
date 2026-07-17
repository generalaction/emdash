import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import {
  PullRequestsStore,
  PullRequestsStoreProvider,
} from '@root/src/core/services/pull-requests/browser';

export function ProjectPullRequestsProvider({
  repositoryUrls,
  children,
}: {
  repositoryUrls: string[];
  children: ReactNode;
}) {
  const [store, setStore] = useState<PullRequestsStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repositoryKey = repositoryUrls.join('\n');
  const stableRepositoryUrls = useMemo(
    () => (repositoryKey ? repositoryKey.split('\n') : []),
    [repositoryKey]
  );

  useEffect(() => {
    let disposed = false;
    let createdStore: PullRequestsStore | undefined;
    setError(null);
    void getPullRequestsRuntimeClient()
      .then(async (client) => {
        if (disposed) return;
        createdStore = new PullRequestsStore(client, stableRepositoryUrls);
        createdStore.listView.store.initialize();
        await createdStore.ready;
        if (disposed) {
          await createdStore.dispose();
          return;
        }
        setStore(createdStore);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
      setStore(null);
      if (createdStore) void createdStore.dispose();
    };
  }, [stableRepositoryUrls]);

  if (error) {
    return (
      <p className="py-4 text-center text-sm text-foreground-error">
        Could not load pull requests: {error}
      </p>
    );
  }
  if (!store) {
    return <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>;
  }
  return <PullRequestsStoreProvider store={store}>{children}</PullRequestsStoreProvider>;
}
