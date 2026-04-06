import React, { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ArrowUp, Tag } from 'lucide-react';

interface Commit {
  hash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  isPushed: boolean;
  tags: string[];
}

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
  author: string;
}

interface CommitListProps {
  taskPath?: string;
  selectedCommit: string | null;
  onSelectCommit: (commit: CommitInfo) => void;
  initialCommitHash?: string;
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

/** Try to extract a GitHub username from an email address. */
function githubLoginFromEmail(email: string): string | null {
  if (!email) return null;
  // GitHub noreply: 12345+username@users.noreply.github.com
  const noreply = email.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/i);
  if (noreply) return noreply[1];
  // Older noreply: username@users.noreply.github.com
  const oldNoreply = email.match(/^([^@]+)@users\.noreply\.github\.com$/i);
  if (oldNoreply) return oldNoreply[1];
  return null;
}

function getAvatarUrl(author: string, authorEmail: string): string {
  const login = githubLoginFromEmail(authorEmail);
  if (login) return `https://github.com/${login}.png?size=40`;
  // Fall back to trying the author name as a GitHub username
  return `https://github.com/${author}.png?size=40`;
}

function AuthorAvatar({ author, authorEmail }: { author: string; authorEmail: string }) {
  const [failed, setFailed] = useState(false);

  const url = getAvatarUrl(author, authorEmail);

  if (failed) return null;

  return (
    <img
      src={url}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={(e: SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.display = 'none';
        setFailed(true);
      }}
    />
  );
}

export const CommitList: React.FC<CommitListProps> = ({
  taskPath,
  selectedCommit,
  onSelectCommit,
  initialCommitHash,
}) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [aheadCount, setAheadCount] = useState<number | undefined>(undefined);

  const onSelectCommitRef = useRef(onSelectCommit);
  onSelectCommitRef.current = onSelectCommit;

  useEffect(() => {
    if (!taskPath) {
      setCommits([]);
      setHasMore(false);
      setAheadCount(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await window.electronAPI.gitGetLog({ taskPath, maxCount: PAGE_SIZE });
        if (!cancelled && res?.success && res.commits) {
          setCommits(res.commits);
          setAheadCount(res.aheadCount);
          setHasMore(res.commits.length >= PAGE_SIZE);
          // Auto-select initial commit or latest if none is selected
          if (res.commits.length > 0 && !selectedCommit) {
            const target = initialCommitHash
              ? res.commits.find((c) => c.hash === initialCommitHash) || res.commits[0]
              : res.commits[0];
            onSelectCommitRef.current({
              hash: target.hash,
              subject: target.subject,
              body: target.body,
              author: target.author,
            });
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
    // Intentionally only re-run on taskPath change. onSelectCommit and selectedCommit
    // are excluded to avoid re-fetching commits when the parent re-renders with new callbacks.
  }, [taskPath]);

  const loadMore = useCallback(async () => {
    if (!taskPath || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await window.electronAPI.gitGetLog({
        taskPath,
        maxCount: PAGE_SIZE,
        skip: commits.length,
        aheadCount,
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
  }, [taskPath, loadingMore, hasMore, commits.length, aheadCount]);

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
          onClick={() =>
            onSelectCommit({
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
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AuthorAvatar author={commit.author} authorEmail={commit.authorEmail} />
                <span className="truncate">
                  {commit.author} &middot; {formatRelativeDate(commit.date)}
                </span>
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
};
