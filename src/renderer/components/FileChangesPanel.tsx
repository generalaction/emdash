import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { useCreatePR } from '../hooks/useCreatePR';
import ChangesDiffModal from './ChangesDiffModal';
import { useFileChanges } from '../hooks/useFileChanges';
import { usePrStatus } from '../hooks/usePrStatus';
import PrStatusSkeleton from './ui/pr-status-skeleton';
import FileTypeIcon from './ui/file-type-icon';
import { Plus, Undo2, ArrowUpRight } from 'lucide-react';

interface FileChangesPanelProps {
  workspaceId: string;
  className?: string;
}

const FileChangesPanelComponent: React.FC<FileChangesPanelProps> = ({ workspaceId, className }) => {
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [stagingFiles, setStagingFiles] = useState<Set<string>>(new Set());
  const [revertingFiles, setRevertingFiles] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const { isCreating: isCreatingPR, createPR } = useCreatePR();
  const { fileChanges, refreshChanges } = useFileChanges(workspaceId);
  const { toast } = useToast();
  const hasChanges = fileChanges.length > 0;
  const hasStagedChanges = fileChanges.some((change) => change.isStaged);
  const { pr, loading: prLoading, refresh: refreshPr } = usePrStatus(workspaceId);
  const [branchAhead, setBranchAhead] = useState<number | null>(null);
  const [branchStatusLoading, setBranchStatusLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!workspaceId || hasChanges) {
        setBranchAhead(null);
        return;
      }
      setBranchStatusLoading(true);
      try {
        const res = await window.electronAPI.getBranchStatus({ workspacePath: workspaceId });
        if (!cancelled) {
          setBranchAhead(res?.success ? (res?.ahead ?? 0) : 0);
        }
      } catch {
        if (!cancelled) setBranchAhead(0);
      } finally {
        if (!cancelled) setBranchStatusLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, hasChanges]);

  const handleStageFile = async (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent opening diff modal
    setStagingFiles((prev) => new Set(prev).add(filePath));

    try {
      const result = await window.electronAPI.stageFile({
        workspacePath: workspaceId,
        filePath,
      });

      if (result.success) {
        await refreshChanges();
      } else {
        toast({
          title: 'Stage Failed',
          description: result.error || 'Failed to stage file.',
          variant: 'destructive',
        });
      }
    } catch (_error) {
      toast({
        title: 'Stage Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setStagingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(filePath);
        return newSet;
      });
    }
  };

  const handleRevertFile = async (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent opening diff modal
    setRevertingFiles((prev) => new Set(prev).add(filePath));

    try {
      const result = await window.electronAPI.revertFile({
        workspacePath: workspaceId,
        filePath,
      });

      if (result.success) {
        const action = result.action;
        if (action !== 'unstaged') {
          toast({
            title: 'File Reverted',
            description: `${filePath} changes have been reverted.`,
          });
        }
        await refreshChanges();
      } else {
        toast({
          title: 'Revert Failed',
          description: result.error || 'Failed to revert file.',
          variant: 'destructive',
        });
      }
    } catch (_error) {
      toast({
        title: 'Revert Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setRevertingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(filePath);
        return newSet;
      });
    }
  };

  const handleCommitAndPush = async () => {
    if (!commitMessage.trim()) {
      toast({
        title: 'Commit Message Required',
        description: 'Please enter a commit message.',
        variant: 'destructive',
      });
      return;
    }

    if (!hasStagedChanges) {
      toast({
        title: 'No Staged Changes',
        description: 'Please stage some files before committing.',
        variant: 'destructive',
      });
      return;
    }

    setIsCommitting(true);
    try {
      const result = await window.electronAPI.gitCommitAndPush({
        workspacePath: workspaceId,
        commitMessage: commitMessage.trim(),
        createBranchIfOnDefault: true,
        branchPrefix: 'feature',
      });

      if (result.success) {
        toast({
          title: 'Committed and Pushed',
          description: `Changes committed with message: "${commitMessage.trim()}"`,
        });
        setCommitMessage(''); // Clear the input
        await refreshChanges();
        try {
          await refreshPr();
        } catch {}
        // Proactively load branch status so the Create PR button appears immediately
        try {
          setBranchStatusLoading(true);
          const bs = await window.electronAPI.getBranchStatus({ workspacePath: workspaceId });
          setBranchAhead(bs?.success ? (bs?.ahead ?? 0) : 0);
        } catch {
          setBranchAhead(0);
        } finally {
          setBranchStatusLoading(false);
        }
      } else {
        toast({
          title: 'Commit Failed',
          description: result.error || 'Failed to commit and push changes.',
          variant: 'destructive',
        });
      }
    } catch (_error) {
      toast({
        title: 'Commit Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const renderPath = (p: string) => {
    const last = p.lastIndexOf('/');
    const dir = last >= 0 ? p.slice(0, last + 1) : '';
    const base = last >= 0 ? p.slice(last + 1) : p;
    return (
      <span className="truncate">
        {dir && <span className="text-gray-500 dark:text-gray-400">{dir}</span>}
        <span className="font-medium text-gray-900 dark:text-gray-100">{base}</span>
      </span>
    );
  };

  const totalChanges = fileChanges.reduce(
    (acc, change) => ({
      additions: acc.additions + change.additions,
      deletions: acc.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div className={`flex h-full flex-col bg-white shadow-sm dark:bg-gray-800 ${className}`}>
      <div className="bg-gray-50 px-3 py-2 dark:bg-gray-900">
        {hasChanges ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {fileChanges.length} files changed
                </span>
                <div className="flex items-center space-x-1 text-xs">
                  <span className="font-medium text-green-600 dark:text-green-400">
                    +{totalChanges.additions}
                  </span>
                  <span className="text-gray-400">•</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{totalChanges.deletions}
                  </span>
                </div>
                {hasStagedChanges && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-300">
                    {fileChanges.filter((f) => f.isStaged).length} staged
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-gray-200 px-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
                disabled={isCreatingPR}
                title="Commit all changes and create a pull request"
                onClick={async () => {
                  await createPR({
                    workspacePath: workspaceId,
                    onSuccess: async () => {
                      await refreshChanges();
                      try {
                        await refreshPr();
                      } catch {}
                    },
                  });
                }}
              >
                {isCreatingPR ? <Spinner size="sm" /> : 'Create PR'}
              </Button>
            </div>

            {hasStagedChanges && (
              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Enter commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="h-8 flex-1 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleCommitAndPush();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-gray-200 px-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  title="Commit all staged changes and push the branch"
                  onClick={handleCommitAndPush}
                  disabled={isCommitting || !commitMessage.trim()}
                >
                  {isCommitting ? <Spinner size="sm" /> : 'Commit & Push'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2 p-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Changes</span>
            </div>
            <div className="flex items-center gap-2">
              {prLoading ? (
                <PrStatusSkeleton />
              ) : pr ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pr.url) window.electronAPI?.openExternal?.(pr.url);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  title={`${pr.title || 'Pull Request'} (#${pr.number})`}
                >
                  {pr.isDraft
                    ? 'Draft'
                    : String(pr.state).toUpperCase() === 'OPEN'
                      ? 'View PR'
                      : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
                  <ArrowUpRight className="size-3" />
                </button>
              ) : branchStatusLoading || (branchAhead !== null && branchAhead > 0) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-gray-200 px-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  disabled={isCreatingPR || branchStatusLoading}
                  title="Create a pull request for the current branch"
                  onClick={async () => {
                    await createPR({
                      workspacePath: workspaceId,
                      onSuccess: async () => {
                        await refreshChanges();
                        try {
                          await refreshPr();
                        } catch {}
                      },
                    });
                  }}
                >
                  {isCreatingPR || branchStatusLoading ? <Spinner size="sm" /> : 'Create PR'}
                </Button>
              ) : (
                <span className="text-xs text-gray-500">No PR for this branch</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {fileChanges.map((change, index) => (
          <div
            key={index}
            className={`flex cursor-pointer items-center justify-between border-b border-gray-100 px-4 py-2.5 last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/40 ${
              change.isStaged ? 'bg-gray-50 dark:bg-gray-900/40' : ''
            }`}
            onClick={() => {
              setSelectedPath(change.path);
              setShowDiffModal(true);
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="inline-flex h-4 w-4 items-center justify-center text-gray-500">
                <FileTypeIcon
                  path={change.path}
                  type={change.status === 'deleted' ? 'file' : 'file'}
                  size={14}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{renderPath(change.path)}</div>
              </div>
            </div>
            <div className="ml-3 flex items-center gap-2">
              {change.additions > 0 && (
                <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-green-900/30 dark:text-emerald-300">
                  +{change.additions}
                </span>
              )}
              {change.deletions > 0 && (
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                  -{change.deletions}
                </span>
              )}
              <div className="flex items-center gap-1">
                {!change.isStaged && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-gray-500 hover:bg-gray-50 hover:text-gray-600 dark:hover:bg-gray-900/20 dark:hover:text-gray-400"
                    onClick={(e) => handleStageFile(change.path, e)}
                    disabled={stagingFiles.has(change.path)}
                    title="Stage file for commit"
                  >
                    {stagingFiles.has(change.path) ? (
                      <Spinner size="sm" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-gray-500 hover:bg-gray-50 hover:text-gray-600 dark:hover:bg-gray-900/20 dark:hover:text-gray-400"
                  onClick={(e) => handleRevertFile(change.path, e)}
                  disabled={revertingFiles.has(change.path)}
                  title={
                    change.isStaged
                      ? 'Unstage file (click again to revert)'
                      : 'Revert changes to file'
                  }
                >
                  {revertingFiles.has(change.path) ? (
                    <Spinner size="sm" />
                  ) : (
                    <Undo2 className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {showDiffModal && (
        <ChangesDiffModal
          open={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          workspacePath={workspaceId}
          files={fileChanges}
          initialFile={selectedPath}
          onRefreshChanges={refreshChanges}
        />
      )}
    </div>
  );
};
export const FileChangesPanel = React.memo(FileChangesPanelComponent);

export default FileChangesPanel;
