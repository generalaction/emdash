import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface Commit {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
}

interface CommitListProps {
  taskPath?: string;
  selectedCommit: string | null;
  onSelectCommit: (hash: string) => void;
}

const PAGE_SIZE = 50;

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr || '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
}

export const CommitList: React.FC<CommitListProps> = ({
  taskPath,
  selectedCommit,
  onSelectCommit,
}) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!taskPath) {
      setCommits([]);
      setHasMore(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await window.electronAPI.gitGetLog({ taskPath, maxCount: PAGE_SIZE });
        if (!cancelled && res?.success && res.commits) {
          setCommits(res.commits);
          setHasMore(res.commits.length >= PAGE_SIZE);
          // Auto-select the latest commit if none is selected
          if (res.commits.length > 0 && !selectedCommit) {
            onSelectCommit(res.commits[0].hash);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskPath]);

  const loadMore = useCallback(async () => {
    if (!taskPath || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await window.electronAPI.gitGetLog({
        taskPath,
        maxCount: PAGE_SIZE,
        skip: commits.length,
      });
      if (res?.success && res.commits && res.commits.length > 0) {
        const newCommits = res.commits;
        setCommits((prev) => [...prev, ...newCommits]);
        setHasMore(newCommits.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [taskPath, loadingMore, hasMore, commits.length]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No commits
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          className={`w-full cursor-pointer border-b border-border/50 px-3 py-2 text-left ${
            selectedCommit === commit.hash ? 'bg-accent' : 'hover:bg-muted/50'
          }`}
          onClick={() => onSelectCommit(commit.hash)}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {commit.subject ? <div className="truncate text-sm">{commit.subject}</div> : null}
              <div className="text-xs text-muted-foreground">
                {commit.author} &middot; {formatRelativeDate(commit.date)}
              </div>
            </div>
            {!commit.isPushed && (
              <ArrowUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
            )}
          </div>
        </button>
      ))}
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="w-full px-3 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
};
