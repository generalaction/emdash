import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Undo2 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import type { FileChange } from '../../hooks/useFileChanges';
import { subscribeToFileChanges } from '../../lib/fileChangeEvents';

interface CommitAreaProps {
  taskPath?: string;
  fileChanges: FileChange[];
  onRefreshChanges?: () => Promise<void> | void;
}

interface LatestCommit {
  hash: string;
  subject: string;
  body: string;
  isPushed: boolean;
}

function friendlyGitError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('non-fast-forward') || s.includes('tip of your current branch is behind'))
    return 'Remote has new commits. Pull before pushing.';
  if (s.includes('merge conflict') || s.includes('fix conflicts'))
    return 'Merge conflicts detected. Resolve them in your editor.';
  if (s.includes('permission denied') || s.includes('authentication'))
    return 'Authentication failed. Check your credentials.';
  if (s.includes('could not resolve host') || s.includes('unable to access'))
    return 'Cannot reach remote. Check your network connection.';
  if (s.includes('no such remote')) return 'No remote configured for this repository.';
  if (s.includes('cannot undo the initial commit')) return 'Cannot undo the initial commit.';
  if (s.includes('nothing to commit')) return 'Nothing to commit.';
  // Return first meaningful line, capped
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}

export const CommitArea: React.FC<CommitAreaProps> = ({
  taskPath,
  fileChanges,
  onRefreshChanges,
}) => {
  const { toast } = useToast();
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [latestCommit, setLatestCommit] = useState<LatestCommit | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [aheadCount, setAheadCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);

  const hasStagedFiles = fileChanges.some((f) => f.isStaged);
  const canCommit = hasStagedFiles && commitMessage.trim().length > 0 && !isCommitting;

  const fetchBranch = useCallback(async () => {
    if (!taskPath) return;
    const result = await window.electronAPI.getBranchStatus({ taskPath });
    if (result.success) {
      if (result.branch) setBranch(result.branch);
      if (typeof result.ahead === 'number') setAheadCount(result.ahead);
      if (typeof result.behind === 'number') setBehindCount(result.behind);
    }
  }, [taskPath]);

  const fetchLatestCommit = useCallback(async () => {
    if (!taskPath) return;
    const result = await window.electronAPI.gitGetLatestCommit({ taskPath });
    if (result.success) {
      setLatestCommit(result.commit ?? null);
    }
  }, [taskPath]);

  useEffect(() => {
    void fetchBranch();
    void fetchLatestCommit();
  }, [fetchBranch, fetchLatestCommit]);

  // Refresh branch status when file changes are detected (external git operations, watchers)
  useEffect(() => {
    if (!taskPath) return;
    return subscribeToFileChanges((event) => {
      if (event.detail.taskPath === taskPath) {
        void fetchBranch();
        void fetchLatestCommit();
      }
    });
  }, [taskPath, fetchBranch, fetchLatestCommit]);

  const handleCommit = async () => {
    if (!taskPath || !canCommit) return;
    setIsCommitting(true);
    try {
      const message = description.trim()
        ? `${commitMessage.trim()}\n\n${description.trim()}`
        : commitMessage.trim();
      const result = await window.electronAPI.gitCommit({ taskPath, message });
      if (result.success) {
        setCommitMessage('');
        setDescription('');
        await onRefreshChanges?.();
        await fetchLatestCommit();
        await fetchBranch();
      } else {
        toast({
          title: 'Commit failed',
          description: friendlyGitError(result?.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Commit failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const hasUnpushed = aheadCount > 0 || (latestCommit != null && !latestCommit.isPushed);

  const handlePush = async () => {
    if (!taskPath || !hasUnpushed || isPushing) return;
    setIsPushing(true);
    try {
      const result = await window.electronAPI.gitPush({ taskPath });
      if (!result?.success) {
        toast({
          title: 'Push failed',
          description: friendlyGitError(result?.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
      await fetchBranch();
      await fetchLatestCommit();
    } catch (err) {
      toast({
        title: 'Push failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!taskPath || isPulling) return;
    setIsPulling(true);
    try {
      const result = await window.electronAPI.gitPull({ taskPath });
      if (!result?.success) {
        toast({
          title: 'Pull failed',
          description: friendlyGitError(result?.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
      await fetchBranch();
      await fetchLatestCommit();
      await onRefreshChanges?.();
    } catch (err) {
      toast({
        title: 'Pull failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsPulling(false);
    }
  };

  const handleUndo = async () => {
    if (!taskPath || isUndoing) return;
    setIsUndoing(true);
    try {
      const result = await window.electronAPI.gitSoftReset({ taskPath });
      if (result.success) {
        if (result.subject) setCommitMessage(result.subject);
        if (result.body) setDescription(result.body);
        await onRefreshChanges?.();
        await fetchLatestCommit();
        await fetchBranch();
      } else {
        toast({
          title: 'Undo failed',
          description: friendlyGitError(result?.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Undo failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border p-3">
      {/* Branch name */}
      {branch && (
        <span className="truncate text-xs text-muted-foreground" title={branch}>
          On branch <span className="font-medium text-foreground">{branch}</span>
        </span>
      )}

      {/* Commit message input */}
      <input
        type="text"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        placeholder="Enter commit message"
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && canCommit) {
            void handleCommit();
          }
        }}
      />

      {/* Description textarea */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Commit & Push & Pull buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit
        </button>
        <button
          onClick={() => void handlePush()}
          disabled={!hasUnpushed || isPushing}
          className="flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={
            hasUnpushed
              ? `Push${aheadCount > 0 ? ` ${aheadCount} commit${aheadCount > 1 ? 's' : ''}` : ''}`
              : 'No unpushed commits'
          }
        >
          <ArrowUp className="h-3 w-3" />
          Push{aheadCount > 0 ? ` (${aheadCount})` : ''}
        </button>
        {behindCount > 0 && (
          <button
            onClick={() => void handlePull()}
            disabled={isPulling}
            className="flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={`Pull ${behindCount} commit${behindCount > 1 ? 's' : ''} from remote`}
          >
            <ArrowDown className="h-3 w-3" />
            Pull ({behindCount})
          </button>
        )}
      </div>

      {/* Separator — full width edge to edge */}
      <hr className="-mx-3 border-border" />

      {/* Latest commit */}
      {latestCommit && (
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={latestCommit.subject}
          >
            {latestCommit.subject}
          </span>
          {!latestCommit.isPushed && (
            <button
              onClick={() => void handleUndo()}
              disabled={isUndoing}
              className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Undo last commit"
            >
              <Undo2 className="h-3 w-3" />
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
};
