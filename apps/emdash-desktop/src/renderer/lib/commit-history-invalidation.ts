import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { gitRepoUpdateChannel } from '@shared/core/git/gitEvents';

export function wireCommitHistoryInvalidation(): void {
  events.on(gitRepoUpdateChannel, (p) => {
    if (p.update.kind !== 'refs') return;
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[1] === 'pr-commits',
    });
  });
}
