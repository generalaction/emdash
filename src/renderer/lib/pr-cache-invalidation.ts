import { prSyncProgressChannel } from '@shared/events/prEvents';
import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

export function wirePrCacheInvalidation(): void {
  events.on(prSyncProgressChannel, (progress) => {
    if (progress.status !== 'running' && progress.status !== 'done') return;
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'pull-requests' && query.queryKey[2] === progress.remoteUrl,
    });
  });
}
