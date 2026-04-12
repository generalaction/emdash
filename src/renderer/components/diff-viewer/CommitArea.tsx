import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Undo2, Loader2 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useErrorDetails } from '../../hooks/useErrorDetails';
import { friendlyGitError } from '../../lib/friendlyGitError';
import type { FileChange } from '../../hooks/useFileChanges';
import { subscribeToFileChanges } from '../../lib/fileChangeEvents';
import { Checkbox } from '../ui/checkbox';

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

export const CommitArea: React.FC<CommitAreaProps> = ({
  taskPath,
  fileChanges,
  onRefreshChanges,
}) => {
  const { toast } = useToast();
  const { showError, errorDialog } = useErrorDetails();
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
  const [skipHooks, setSkipHooks] = useState(false);

  const showGitError = useCallback(
    (title: string, rawError: string) => {
      showError(title, rawError, { summarize: friendlyGitError });
    },
    [showError]
  );

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
      const result = await window.electronAPI.gitCommit({
        taskPath,
        message,
        noVerify: skipHooks,
      });
      if (result.success) {
        setCommitMessage('');
        setDescription('');
        await onRefreshChanges?.();
        await fetchLatestCommit();
        await fetchBranch();
      } else {
        showGitError('Commit failed', result?.error || 'Unknown error');
      }
    } catch (err) {
      showGitError('Commit failed', err instanceof Error ? err.message : String(err));
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
      if (result?.success) {
        toast({ title: 'Pushed successfully' });
      } else {
        showGitError('Push failed', result?.error || 'Unknown error');
      }
      await fetchBranch();
      await fetchLatestCommit();
    } catch (err) {
      showGitError('Push failed', err instanceof Error ? err.message : String(err));
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
        showGitError('Pull failed', result?.error || 'Unknown error');
      }
      await fetchBranch();
      await fetchLatestCommit();
      await onRefreshChanges?.();
    } catch (err) {
      showGitError('Pull failed', err instanceof Error ? err.message : String(err));
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
        showGitError('Undo failed', result?.error || 'Unknown error');
      }
    } catch (err) {
      showGitError('Undo failed', err instanceof Error ? err.message : String(err));
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

      {/* Skip git hooks toggle */}
      <label
        className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        title="Pass --no-verify when committing. Bypasses pre-commit and commit-msg hooks."
      >
        <Checkbox
          checked={skipHooks}
          onCheckedChange={(checked) => setSkipHooks(checked === true)}
          className="h-3.5 w-3.5"
        />
        Skip git hooks
        <span className="font-mono text-[10px] opacity-60">--no-verify</span>
      </label>

      {/* Commit & Push & Pull buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCommitting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Committing...
            </>
          ) : (
            'Commit'
          )}
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
          {isPushing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )}
          {isPushing ? 'Pushing...' : <>Push{aheadCount > 0 ? ` (${aheadCount})` : ''}</>}
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

      {errorDialog}
    </div>
  );
};
