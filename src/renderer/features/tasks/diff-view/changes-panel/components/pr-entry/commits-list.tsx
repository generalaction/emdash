import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import type { Commit } from '@shared/git';
import { usePrCommits } from './use-pr-commits';

const ITEM_HEIGHT = 43;

export const PrCommitsList = observer(function PrCommitsList() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const pr = taskView.prStore?.currentPr;
  const { data, isFetchingNextPage, hasNextPage, fetchNextPage } = usePrCommits(
    projectId,
    workspaceId,
    pr
  );

  const commits = data?.pages.flat() ?? [];
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  if (commits.length === 0 && !isFetchingNextPage) {
    return <EmptyState label="No commits" description="No commits available" />;
  }

  return (
    <div ref={parentRef} className="h-full overflow-x-hidden overflow-y-auto py-2">
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
      {hasNextPage && (
        <div className="flex justify-center py-2">
          <button
            className="hover:bg-surface-raised rounded-md px-3 py-1 text-xs text-foreground-muted transition-colors hover:text-foreground"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
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
      <div className="min-w-0 flex-1 rounded-md px-2 py-1">
        <div className="truncate text-sm">{commit.subject}</div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
          <span className="min-w-0 truncate font-medium">{commit.author}</span>
          {'·'}
          <RelativeTime compact value={commit.date} className="text-foreground-muted" />
          {'·'}
          <span className="font-mono text-foreground-passive">{shortHash}</span>
        </div>
      </div>
    </div>
  );
}
