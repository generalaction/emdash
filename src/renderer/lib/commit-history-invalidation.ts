import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { gitRefChangedChannel } from '@shared/core/git/gitEvents';

export function wireCommitHistoryInvalidation(): void {
  events.on(gitRefChangedChannel, (p) => {
    if (p.kind !== 'remote-refs') return;
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[1] === 'pr-commits',
    });
  });
}
