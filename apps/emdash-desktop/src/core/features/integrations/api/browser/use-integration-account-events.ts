import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getIntegrationsClient } from './client';
import { invalidateProviderAccountState } from './use-provider-accounts';

/** Refresh the shared inventory for changes made by any connection or account flow. */
export function useIntegrationAccountEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => {
      void invalidateProviderAccountState(queryClient);
    };
    void getIntegrationsClient().then(async (client) => {
      const nextUnsubscribe = await client.events.subscribe(undefined, {
        onEvent: refresh,
        onGap: refresh,
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [queryClient]);
}
