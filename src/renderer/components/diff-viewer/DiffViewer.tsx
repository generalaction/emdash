import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useFileChanges, type FileChange } from '../../hooks/useFileChanges';
import { useTaskScope } from '../TaskScopeContext';
import { fetchPrBaseDiff, parseDiffToFileChanges } from '../../lib/parsePrDiff';
import { ChangesTab } from './ChangesTab';
import { HistoryTab } from './HistoryTab';

interface DiffViewerProps {
  onClose: () => void;
  taskId?: string;
  taskPath?: string;
  initialFile?: string | null;
  initialCommit?: string | null;
}

type Tab = 'changes' | 'history';

export const DiffViewer: React.FC<DiffViewerProps> = ({
  onClose,
  taskId,
  taskPath,
  initialFile,
  initialCommit,
}) => {
  const { prNumber, taskPath: scopedTaskPath } = useTaskScope();
  const isPrReview = Boolean(prNumber && (taskPath || scopedTaskPath));

  const [activeTab, setActiveTab] = useState<Tab>(initialCommit ? 'history' : 'changes');
  const { fileChanges: localFileChanges, refreshChanges } = useFileChanges(taskPath);

  // PR review mode: fetch PR diff changes and base branch
  const [prFileChanges, setPrFileChanges] = useState<FileChange[]>([]);
  const [prBaseRef, setPrBaseRef] = useState<string | null>(null);

  const fetchPrDiff = useCallback(async () => {
    const worktreePath = taskPath || scopedTaskPath;
    if (!prNumber || !worktreePath) return;
    try {
      const result = await fetchPrBaseDiff(worktreePath, prNumber);
      if (result.success) {
        setPrFileChanges(parseDiffToFileChanges(result.diff ?? ''));
        setPrBaseRef(result.baseBranch ? `origin/${result.baseBranch}` : null);
      } else {
        setPrFileChanges([]);
        setPrBaseRef(null);
      }
    } catch (err) {
      console.error('Failed to fetch PR diff for DiffViewer:', err);
    }
  }, [prNumber, taskPath, scopedTaskPath]);

  useEffect(() => {
    if (isPrReview) {
      fetchPrDiff();
    }
  }, [isPrReview, fetchPrDiff]);

  const fileChanges = isPrReview ? prFileChanges : localFileChanges;
  const fileCount = fileChanges.length;
  const [leftPanelSize, setLeftPanelSize] = useState(30);

  const tabHeader = (
    <div className="flex h-9 border-b border-border bg-muted/50">
      <button
        onClick={() => setActiveTab('changes')}
        className={`flex-1 text-center text-sm font-medium transition-colors ${
          activeTab === 'changes'
            ? 'border-b-2 border-foreground text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Changes{fileCount > 0 ? ` (${fileCount})` : ''}
      </button>
      <button
        onClick={() => setActiveTab('history')}
        className={`flex-1 text-center text-sm font-medium transition-colors ${
          activeTab === 'history'
            ? 'border-b-2 border-foreground text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        History
      </button>
    </div>
  );

  const closeButton = (
    <button
      onClick={onClose}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Close diff viewer"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <ChangesTab
            taskId={taskId}
            taskPath={taskPath || scopedTaskPath}
            fileChanges={fileChanges}
            onRefreshChanges={isPrReview ? undefined : refreshChanges}
            header={tabHeader}
            closeButton={closeButton}
            leftPanelSize={leftPanelSize}
            onLeftPanelResize={setLeftPanelSize}
            initialFile={initialFile}
            baseRef={prBaseRef || undefined}
          />
        ) : (
          <HistoryTab
            taskPath={taskPath || scopedTaskPath}
            header={tabHeader}
            closeButton={closeButton}
            leftPanelSize={leftPanelSize}
            onLeftPanelResize={setLeftPanelSize}
            initialCommitHash={initialCommit || undefined}
            initialFile={activeTab === 'history' ? initialFile || undefined : undefined}
          />
        )}
      </div>
    </div>
  );
};
