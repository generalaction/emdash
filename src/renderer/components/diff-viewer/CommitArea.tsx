import React, { useCallback, useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
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

  const hasStagedFiles = fileChanges.some((f) => f.isStaged);
  const canCommit = hasStagedFiles && commitMessage.trim().length > 0 && !isCommitting;

  const fetchBranch = useCallback(async () => {
    if (!taskPath) return;
    const result = await window.electronAPI.getBranchStatus({ taskPath });
    if (result.success && result.branch) {
      setBranch(result.branch);
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
      }
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCommitAndPush = async () => {
    if (!taskPath || !canCommit) return;
    setIsCommitting(true);
    try {
      const message = description.trim()
        ? `${commitMessage.trim()}\n\n${description.trim()}`
        : commitMessage.trim();
      const commitResult = await window.electronAPI.gitCommit({ taskPath, message });
      if (commitResult.success) {
        await window.electronAPI.gitPush({ taskPath });
        setCommitMessage('');
        setDescription('');
        await onRefreshChanges?.();
        await fetchLatestCommit();
      }
    } finally {
      setIsCommitting(false);
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

      {/* Commit buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit
        </button>
        <button
          onClick={() => void handleCommitAndPush()}
          disabled={!canCommit}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit & Push
        </button>
      </div>

      {/* Separator */}
      <hr className="border-border" />

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
