import React, { useEffect, useState } from 'react';

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

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export const CommitList: React.FC<CommitListProps> = ({
  taskPath,
  selectedCommit,
  onSelectCommit,
}) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskPath) {
      setCommits([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await window.electronAPI.gitGetLog({ taskPath, maxCount: 50 });
        if (!cancelled && res?.success && res.commits) {
          setCommits(res.commits);
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
  }, [taskPath]);

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
          <div className="truncate text-sm">{commit.subject}</div>
          <div className="text-xs text-muted-foreground">
            {commit.author} &middot; {formatRelativeDate(commit.date)}
          </div>
        </button>
      ))}
    </div>
  );
};
