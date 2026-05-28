import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { shouldInvalidatePrListQuery } from '@renderer/lib/should-invalidate-pr-list-query';
import { prSyncProgressChannel } from '@shared/events/prEvents';

export function wirePrCacheInvalidation(): void {
  events.on(prSyncProgressChannel, (progress) => {
    void queryClient.invalidateQueries({
      predicate: (query) => shouldInvalidatePrListQuery(query.queryKey, progress),
    });
  });
}
