import { ArrowUp, Tag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/core/ipc';
import { PAGE_SIZE } from './constants';
import { useDiffViewContext } from './diff-view-provider';
import { CommitEntry } from './types';
import { formatRelativeDate } from './utils';

export function CommitListSection() {
  const { projectId, taskId, selectedCommit, setSelectedCommit } = useDiffViewContext();
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [aheadCount, setAheadCount] = useState<number | undefined>(undefined);

  const setSelectedCommitRef = useRef(setSelectedCommit);
  setSelectedCommitRef.current = setSelectedCommit;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await rpc.git.getLog(projectId, taskId, PAGE_SIZE);
        if (!cancelled && res?.success && res.data?.commits) {
          const fetched = res.data.commits as CommitEntry[];
          setCommits(fetched);
          setAheadCount(res.data.aheadCount as number | undefined);
          setHasMore(fetched.length >= PAGE_SIZE);
          if (fetched.length > 0 && !selectedCommit) {
            const c = fetched[0];
            setSelectedCommitRef.current({
              hash: c.hash,
              subject: c.subject,
              body: c.body,
              author: c.author,
            });
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await rpc.git.getLog(projectId, taskId, PAGE_SIZE, commits.length, aheadCount);
      if (res?.success && res.data?.commits) {
        const newCommits = res.data.commits as CommitEntry[];
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
  }, [projectId, taskId, loadingMore, hasMore, commits.length, aheadCount]);

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
            selectedCommit?.hash === commit.hash ? 'bg-accent' : 'hover:bg-muted/50'
          }`}
          onClick={() =>
            setSelectedCommit({
              hash: commit.hash,
              subject: commit.subject,
              body: commit.body,
              author: commit.author,
            })
          }
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {commit.subject ? <div className="truncate text-sm">{commit.subject}</div> : null}
              <div className="text-xs text-muted-foreground">
                {commit.author} &middot; {formatRelativeDate(commit.date)}
              </div>
            </div>
            {commit.tags.length > 0 &&
              commit.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}
            {!commit.isPushed && (
              <span title="Not yet pushed to remote">
                <ArrowUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              </span>
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
}
