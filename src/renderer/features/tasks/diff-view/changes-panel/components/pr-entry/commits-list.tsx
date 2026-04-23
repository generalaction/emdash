import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import type { Commit } from '@shared/git';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';

const ITEM_HEIGHT = 52;

export const PrCommitsList = observer(function PrCommitsList() {
  const prStore = useProvisionedTask().workspace.pr;
  const { data, loading } = prStore.commitHistory;
  const parentRef = useRef<HTMLDivElement>(null);

  const aheadCount = data?.aheadCount ?? 0;
  const allCommits = data?.commits ?? [];
  // Show only the commits that are ahead of upstream — those belong to the PR.
  // If aheadCount is 0 (e.g. upstream not configured), fall back to all commits.
  const commits = aheadCount > 0 ? allCommits.slice(0, aheadCount) : allCommits;

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return <EmptyState label="No commits" description="No commits available" />;
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const commit = commits[virtualItem.index]!;
          return (
            <div
              key={commit.hash}
              style={{
                position: 'absolute',
                top: virtualItem.start,
                left: 0,
                width: '100%',
                height: ITEM_HEIGHT,
              }}
            >
              <CommitItem
                commit={commit}
                isFirst={virtualItem.index === 0}
                isLast={virtualItem.index === commits.length - 1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

function CommitItem({
  commit,
  isFirst,
  isLast,
}: {
  commit: Commit;
  isFirst: boolean;
  isLast: boolean;
}) {
  const shortHash = commit.hash.slice(0, 7);

  return (
    <div className="flex items-stretch">
      <div className="flex w-3.5 shrink-0 flex-col items-center">
        <div className={cn('w-px flex-1 bg-border', isFirst && 'invisible')} />
        <div className="size-1.5 shrink-0 rounded-full bg-foreground-passive" />
        <div className={cn('w-px flex-1 bg-border', isLast && 'invisible')} />
      </div>
      <div className="min-w-0 flex-1 p-2 rounded-md">
        <div className="truncate text-sm">{commit.subject}</div>
        <div className="flex items-center  gap-1 text-xs text-foreground-muted">
          <span className="truncate font-medium ">{commit.author}</span>
          {'·'}
          <RelativeTime compact value={commit.date} ago className="text-foreground-muted" />
          {'·'}
          <span className="font-mono text-foreground-passive">{shortHash}</span>
        </div>
      </div>
    </div>
  );
}
