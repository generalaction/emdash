import { gitRefChangedChannel } from '@shared/events/gitEvents';
import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

export function wireCommitHistoryInvalidation(): void {
  events.on(gitRefChangedChannel, (p) => {
    if (p.kind !== 'remote-refs') return;
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[1] === 'pr-commits',
    });
  });
}
