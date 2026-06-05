import type { FetchNextPageOptions, InfiniteQueryObserverResult } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import type { PullRequest } from '@shared/pull-requests';
import { PrRow } from './pr-row';

interface PrVirtualListProps {
  prs: PullRequest[];
  projectId: string;
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: (options?: FetchNextPageOptions) => Promise<InfiniteQueryObserverResult>;
}

export function PrVirtualList({
  prs,
  projectId,
  loading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: PrVirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

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
    return <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>;
  }

  if (error && prs.length === 0) {
    return <EmptyState label="Could not load pull requests" description={error} />;
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
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MultiLineListItem isLast={virtualItem.index === prs.length - 1}>
              <PrRow pr={prs[virtualItem.index]!} projectId={projectId} />
            </MultiLineListItem>
          </div>
        ))}
      </div>
      {isFetchingNextPage && (
        <p className="text-muted-foreground py-2 text-center text-xs">Loading more…</p>
      )}
    </div>
  );
}
