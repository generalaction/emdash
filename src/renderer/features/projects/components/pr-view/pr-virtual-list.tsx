import type { FetchNextPageOptions, InfiniteQueryObserverResult } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { cn } from '@renderer/utils/utils';
import { PrRow } from './pr-row';

interface PrVirtualListProps {
  prs: PullRequest[];
  projectId: string;
  loading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: (options?: FetchNextPageOptions) => Promise<InfiniteQueryObserverResult>;
}

export function PrVirtualList({
  prs,
  projectId,
  loading,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: PrVirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: prs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Trigger next page load when the last virtual item becomes visible
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= prs.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [virtualItems, prs.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (loading && prs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>;
  }

  if (prs.length === 0) {
    return (
      <EmptyState
        label="No pull requests"
        description="No pull requests available or none that match this filter"
      />
    );
  }

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto min-h-0 flex-1 "
      style={{ scrollbarWidth: 'none' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className={cn(
              'border-b border-border py-1',
              virtualItem.index === prs.length - 1 && 'border-b-0'
            )}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <PrRow pr={prs[virtualItem.index]!} projectId={projectId} />
          </div>
        ))}
      </div>
      {isFetchingNextPage && (
        <p className="text-xs text-muted-foreground text-center py-2">Loading more…</p>
      )}
    </div>
  );
}
