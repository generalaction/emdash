import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Undo2 } from 'lucide-react';
import type { FileChange } from '../../hooks/useFileChanges';

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
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [latestCommit, setLatestCommit] = useState<LatestCommit | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [aheadCount, setAheadCount] = useState(0);

  const hasStagedFiles = fileChanges.some((f) => f.isStaged);
  const canCommit = hasStagedFiles && commitMessage.trim().length > 0 && !isCommitting;

  const fetchBranch = useCallback(async () => {
    if (!taskPath) return;
    const result = await window.electronAPI.getBranchStatus({ taskPath });
    if (result.success) {
      if (result.branch) setBranch(result.branch);
      if (typeof result.ahead === 'number') setAheadCount(result.ahead);
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
      }
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
        console.error('Push failed:', result?.error);
      }
      await fetchBranch();
      await fetchLatestCommit();
    } catch (err) {
      console.error('Push failed:', err);
    } finally {
      setIsPushing(false);
    }
  };

  const handleUndo = async () => {
    if (!taskPath) return;
    const result = await window.electronAPI.gitSoftReset({ taskPath });
    if (result.success) {
      if (result.subject) setCommitMessage(result.subject);
      if (result.body) setDescription(result.body);
      await onRefreshChanges?.();
      await fetchLatestCommit();
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

      {/* Commit & Push buttons */}
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
              className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
