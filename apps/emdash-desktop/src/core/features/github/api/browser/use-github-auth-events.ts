import { useToast } from '@emdash/ui/react/primitives';
import { useCallback, useEffect } from 'react';
import type { GitHubUser } from '@core/primitives/github/api';
import { log } from '@core/primitives/logging/browser/logger';
import { getGithubClient } from './client';

/** GitHub device-flow notifications; shared integration events refresh account inventory. */
export function useGitHubAuthEvents() {
  const { toast } = useToast();

  const handleDeviceFlowSuccess = useCallback(
    (flowUser: GitHubUser) => {
      log.info('GitHub auth success via device flow', { user: flowUser?.login });
      toast('Connected to GitHub', {
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [toast]
  );

  const handleDeviceFlowError = useCallback(
    (error: string) => {
      toast.error('Authentication Failed', { description: error });
    },
    [toast]
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getGithubClient().then(async (client) => {
      const nextUnsubscribe = await client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'auth-success') {
            void handleDeviceFlowSuccess(event.user);
          } else if (event.type === 'auth-error') {
            handleDeviceFlowError(event.message || event.error);
          }
        },
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError]);
}
