import React, { useEffect, useRef, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { useCreatePR } from '../hooks/useCreatePR';
import ChangesDiffModal from './ChangesDiffModal';
import AllChangesDiffModal from './AllChangesDiffModal';
import { useFileChanges } from '../hooks/useFileChanges';
import { dispatchFileChangeEvent } from '../lib/fileChangeEvents';
import { usePrStatus } from '../hooks/usePrStatus';
import { useCheckRuns } from '../hooks/useCheckRuns';
import { useAutoCheckRunsRefresh } from '../hooks/useAutoCheckRunsRefresh';
import { usePrComments } from '../hooks/usePrComments';
import { ChecksPanel } from './CheckRunsList';
import { PrCommentsList } from './PrCommentsList';
import MergePrSection from './MergePrSection';
import { FileIcon } from './FileExplorer/FileIcons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Close as PopoverClose } from '@radix-ui/react-popover';
import {
  Plus,
  Minus,
  Undo2,
  ArrowUpRight,
  FileDiff,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  GitMerge,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useTaskScope } from './TaskScopeContext';

type ActiveTab = 'changes' | 'checks';
type PrMode = 'create' | 'draft' | 'merge';

const PR_MODE_LABELS: Record<PrMode, string> = {
  create: 'Create PR',
  draft: 'Draft PR',
  merge: 'Merge into Main',
};

interface PrActionButtonProps {
  mode: PrMode;
  onModeChange: (mode: PrMode) => void;
  onExecute: () => Promise<void>;
  isLoading: boolean;
}

function PrActionButton({ mode, onModeChange, onExecute, isLoading }: PrActionButtonProps) {
  return (
    <div className="flex min-w-0">
      <Button
        variant="outline"
        size="sm"
        className="h-8 min-w-0 truncate rounded-r-none border-r-0 px-2 text-xs"
        disabled={isLoading}
        onClick={onExecute}
      >
        {isLoading ? <Spinner size="sm" /> : PR_MODE_LABELS[mode]}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-l-none px-1.5"
            disabled={isLoading}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto min-w-0 p-0.5">
          {(['create', 'draft', 'merge'] as PrMode[])
            .filter((m) => m !== mode)
            .map((m) => (
              <PopoverClose key={m} asChild>
                <button
                  className="w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => onModeChange(m)}
                >
                  {PR_MODE_LABELS[m]}
                </button>
              </PopoverClose>
            ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-b-2 border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface FileChangesPanelProps {
  taskId?: string;
  taskPath?: string;
  className?: string;
}

const FileChangesPanelComponent: React.FC<FileChangesPanelProps> = ({
  taskId,
  taskPath,
  className,
}) => {
  const { taskId: scopedTaskId, taskPath: scopedTaskPath } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const resolvedTaskPath = taskPath ?? scopedTaskPath;
  const safeTaskPath = resolvedTaskPath ?? '';
  const canRender = Boolean(resolvedTaskId && resolvedTaskPath);

  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showAllChangesModal, setShowAllChangesModal] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);

  // Reset selectedPath when task changes
  useEffect(() => {
    setSelectedPath(undefined);
  }, [resolvedTaskPath]);
  const [stagingFiles, setStagingFiles] = useState<Set<string>>(new Set());
  const [unstagingFiles, setUnstagingFiles] = useState<Set<string>>(new Set());
  const [revertingFiles, setRevertingFiles] = useState<Set<string>>(new Set());
  const [isStagingAll, setIsStagingAll] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isMergingToMain, setIsMergingToMain] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [revertTargetFile, setRevertTargetFile] = useState<string | null>(null);
  const [prMode, setPrMode] = useState<PrMode>(() => {
    try {
      const stored = localStorage.getItem('emdash:prMode');
      if (stored === 'create' || stored === 'draft' || stored === 'merge') return stored;
      // Migrate from old boolean key
      if (localStorage.getItem('emdash:createPrAsDraft') === 'true') return 'draft';
      return 'create';
    } catch {
      // localStorage not available in some environments
      return 'create';
    }
  });
  const { isCreating: isCreatingPR, createPR } = useCreatePR();

  const selectPrMode = (mode: PrMode) => {
    setPrMode(mode);
    try {
      localStorage.setItem('emdash:prMode', mode);
    } catch {
      // localStorage not available
    }
  };

  const { fileChanges, isLoading, refreshChanges } = useFileChanges(safeTaskPath);
  const { toast } = useToast();
  const hasChanges = fileChanges.length > 0;
  const hasStagedChanges = fileChanges.some((change) => change.isStaged);
  const { pr, isLoading: isPrLoading, refresh: refreshPr } = usePrStatus(safeTaskPath);
  const [activeTab, setActiveTab] = useState<ActiveTab>('changes');
  const { status: checkRunsStatus, isLoading: checkRunsLoading } = useCheckRuns(
    pr ? safeTaskPath : undefined
  );
  // Only poll for check runs when the Checks tab is active; the initial fetch
  // from useCheckRuns is enough for the tab badge indicators.
  const checksTabActive = activeTab === 'checks' && !!pr;
  useAutoCheckRunsRefresh(checksTabActive ? safeTaskPath : undefined, checkRunsStatus);
  const prevChecksAllComplete = useRef<boolean | null>(null);
  useEffect(() => {
    if (!checksTabActive || !pr || !checkRunsStatus) return;
    const prev = prevChecksAllComplete.current;
    const next = checkRunsStatus.allComplete;
    prevChecksAllComplete.current = next;
    if (prev === false && next === true) {
      refreshPr().catch(() => {});
    }
  }, [checksTabActive, pr, checkRunsStatus, refreshPr]);
  const { status: prCommentsStatus, isLoading: prCommentsLoading } = usePrComments(
    pr ? safeTaskPath : undefined,
    pr?.number
  );
  const [branchAhead, setBranchAhead] = useState<number | null>(null);
  const [branchStatusLoading, setBranchStatusLoading] = useState<boolean>(false);

  // Default to checks when PR exists but no changes; reset when PR disappears
  useEffect(() => {
    if (!pr) {
      setActiveTab('changes');
    } else if (!hasChanges) {
      setActiveTab('checks');
    }
  }, [pr, hasChanges]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!safeTaskPath) {
        setBranchAhead(null);
        return;
      }

      // Skip branch status check for remote paths (SSH projects)
      // Remote paths typically look like /home/user/... or /root/... which don't exist locally
      const isLikelyRemotePath =
        safeTaskPath.startsWith('/home/') ||
        safeTaskPath.startsWith('/root/') ||
        (!safeTaskPath.startsWith('/Users/') &&
          !safeTaskPath.startsWith('/Volumes/') &&
          !safeTaskPath.startsWith('C:\\') &&
          !safeTaskPath.match(/^[A-Z]:\\/));

      if (isLikelyRemotePath) {
        setBranchAhead(null);
        return;
      }

      setBranchStatusLoading(true);
      try {
        const res = await window.electronAPI.getBranchStatus({ taskPath: safeTaskPath });
        if (!cancelled) {
          setBranchAhead(res?.success ? (res?.ahead ?? 0) : 0);
        }
      } catch {
        // Network or IPC error - default to 0
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
  }, [safeTaskPath, hasChanges]);

  const handleStageFile = async (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setStagingFiles((prev) => new Set(prev).add(filePath));

    try {
      const result = await window.electronAPI.stageFile({
        taskPath: safeTaskPath,
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

  const handleStageAllFiles = async () => {
    setIsStagingAll(true);

    try {
      const result = await window.electronAPI.stageAllFiles({
        taskPath: safeTaskPath,
      });

      if (result.success) {
        await refreshChanges();
      } else {
        toast({
          title: 'Stage All Failed',
          description: result.error || 'Failed to stage all files.',
          variant: 'destructive',
        });
      }
    } catch (_error) {
      toast({
        title: 'Stage All Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsStagingAll(false);
    }
  };

  const handleUnstageFile = async (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setUnstagingFiles((prev) => new Set(prev).add(filePath));

    try {
      const result = await window.electronAPI.unstageFile({
        taskPath: safeTaskPath,
        filePath,
      });

      if (result.success) {
        await refreshChanges();
      } else {
        toast({
          title: 'Unstage Failed',
          description: result.error || 'Failed to unstage file.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Unstage error:', error);
      toast({
        title: 'Unstage Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setUnstagingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(filePath);
        return newSet;
      });
    }
  };

  const confirmRevertFile = (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setRevertTargetFile(filePath);
    setShowRevertConfirm(true);
  };

  const executeRevertFile = async () => {
    const filePath = revertTargetFile;
    if (!filePath) return;
    setRevertTargetFile(null);
    setRevertingFiles((prev) => new Set(prev).add(filePath));

    try {
      const result = await window.electronAPI.revertFile({
        taskPath: safeTaskPath,
        filePath,
      });

      if (result.success) {
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
      // specific file change event to update editor
      dispatchFileChangeEvent(safeTaskPath, filePath);
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
        taskPath: safeTaskPath,
        commitMessage: commitMessage.trim(),
        createBranchIfOnDefault: true,
        branchPrefix: 'feature',
      });

      if (result.success) {
        toast({
          title: 'Committed and Pushed',
          description: `Changes committed with message: "${commitMessage.trim()}"`,
        });
        setCommitMessage('');
        await refreshChanges();
        try {
          await refreshPr();
        } catch {
          // PR refresh is best-effort
        }
        // Proactively load branch status so the Create PR button appears immediately
        // Skip for remote paths (SSH projects)
        const isLikelyRemotePath =
          safeTaskPath.startsWith('/home/') ||
          safeTaskPath.startsWith('/root/') ||
          (!safeTaskPath.startsWith('/Users/') &&
            !safeTaskPath.startsWith('/Volumes/') &&
            !safeTaskPath.startsWith('C:\\') &&
            !safeTaskPath.match(/^[A-Z]:\\/));

        if (!isLikelyRemotePath) {
          try {
            setBranchStatusLoading(true);
            const bs = await window.electronAPI.getBranchStatus({ taskPath: safeTaskPath });
            setBranchAhead(bs?.success ? (bs?.ahead ?? 0) : 0);
          } catch {
            setBranchAhead(0);
          } finally {
            setBranchStatusLoading(false);
          }
        }
      } else {
        toast({
          title: 'Commit Failed',
          description:
            typeof result.error === 'string' ? result.error : 'Failed to commit and push changes.',
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

  const handleMergeToMain = async () => {
    setIsMergingToMain(true);
    try {
      const result = await window.electronAPI.mergeToMain({ taskPath: safeTaskPath });
      if (result.success) {
        toast({
          title: 'Merged to Main',
          description: 'Changes have been merged to main.',
        });
        await refreshChanges();
        try {
          await refreshPr();
        } catch {
          // PR refresh is best-effort
        }
      } else {
        toast({
          title: 'Merge Failed',
          description: result.error || 'Failed to merge to main.',
          variant: 'destructive',
        });
      }
    } catch (_error) {
      toast({
        title: 'Merge Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsMergingToMain(false);
    }
  };

  const handlePrAction = async () => {
    if (prMode === 'merge') {
      setShowMergeConfirm(true);
      return;
    } else {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('pr_viewed');
      })();
      await createPR({
        taskPath: safeTaskPath,
        prOptions: prMode === 'draft' ? { draft: true } : undefined,
        onSuccess: async () => {
          await refreshChanges();
          try {
            await refreshPr();
          } catch {
            // PR refresh is best-effort
          }
        },
      });
    }
  };

  const renderPath = (p: string) => {
    const last = p.lastIndexOf('/');
    const dir = last >= 0 ? p.slice(0, last + 1) : '';
    const base = last >= 0 ? p.slice(last + 1) : p;
    return (
      <span className="flex min-w-0" title={p}>
        {dir && (
          <span className="truncate text-left text-muted-foreground [direction:rtl]">{dir}</span>
        )}
        <span className="shrink-0 font-medium text-foreground">{base}</span>
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

  if (!canRender) {
    return null;
  }

  const isActionLoading = isCreatingPR || isMergingToMain;

  return (
    <div className={`flex h-full flex-col bg-card shadow-sm ${className}`}>
      <div className="bg-muted px-3 py-2">
        {hasChanges ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <div className="flex shrink-0 items-center gap-1 text-xs">
                  <span className="font-medium text-green-600 dark:text-green-400">
                    +{totalChanges.additions}
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{totalChanges.deletions}
                  </span>
                </div>
                {hasStagedChanges && (
                  <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {fileChanges.filter((f) => f.isStaged).length} staged
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {fileChanges.some((f) => !f.isStaged) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    title="Stage all files for commit"
                    onClick={handleStageAllFiles}
                    disabled={isStagingAll}
                  >
                    {isStagingAll ? (
                      <Spinner size="sm" />
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Stage All</span>
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-xs"
                  title="View all changes in a single scrollable view"
                  onClick={() => setShowAllChangesModal(true)}
                >
                  <FileDiff className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Changes</span>
                </Button>
                <PrActionButton
                  mode={prMode}
                  onModeChange={selectPrMode}
                  onExecute={handlePrAction}
                  isLoading={isActionLoading}
                />
              </div>
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
                  className="h-8 px-2 text-xs"
                  title="Commit all staged changes and push"
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
              <span className="text-sm font-medium text-foreground">Changes</span>
            </div>
            <div className="flex items-center gap-2">
              {isPrLoading ? (
                <div className="flex items-center justify-center p-1">
                  <Spinner size="sm" className="h-3.5 w-3.5" />
                </div>
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
                <PrActionButton
                  mode={prMode}
                  onModeChange={selectPrMode}
                  onExecute={handlePrAction}
                  isLoading={isActionLoading || branchStatusLoading}
                />
              ) : (
                <span className="text-xs text-muted-foreground">No PR for this task</span>
              )}
            </div>
          </div>
        )}
      </div>

      {pr && hasChanges && (
        <div className="flex border-b border-border">
          <TabButton active={activeTab === 'changes'} onClick={() => setActiveTab('changes')}>
            Changes
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
              {fileChanges.length}
            </span>
          </TabButton>
          <TabButton active={activeTab === 'checks'} onClick={() => setActiveTab('checks')}>
            Checks
            {checkRunsStatus && !checkRunsStatus.allComplete && (
              <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-foreground" />
            )}
            {checkRunsStatus?.hasFailures && checkRunsStatus.allComplete && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
            )}
          </TabButton>
        </div>
      )}
      {activeTab === 'checks' && pr ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasChanges && (
            <div className="flex items-center gap-1.5 px-4 py-1.5">
              <span className="text-sm font-medium text-foreground">Checks</span>
              {checkRunsStatus?.summary && (
                <div className="flex items-center gap-1.5">
                  {checkRunsStatus.summary.passed > 0 && (
                    <Badge variant="outline">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      {checkRunsStatus.summary.passed} passed
                    </Badge>
                  )}
                  {checkRunsStatus.summary.failed > 0 && (
                    <Badge variant="outline">
                      <XCircle className="h-3 w-3 text-red-500" />
                      {checkRunsStatus.summary.failed} failed
                    </Badge>
                  )}
                  {checkRunsStatus.summary.pending > 0 && (
                    <Badge variant="outline">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {checkRunsStatus.summary.pending} pending
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
          <ChecksPanel
            status={checkRunsStatus}
            isLoading={checkRunsLoading}
            hasPr={!!pr}
            hideSummary={!hasChanges}
          />
          <PrCommentsList
            status={prCommentsStatus}
            isLoading={prCommentsLoading}
            hasPr={!!pr}
            prUrl={pr?.url}
          />
          <MergePrSection taskPath={safeTaskPath} pr={pr} refreshPr={refreshPr} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && fileChanges.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="lg" className="text-muted-foreground" />
            </div>
          ) : (
            fileChanges.map((change, index) => (
              <div
                key={index}
                className={`flex cursor-pointer items-center justify-between border-b border-border/50 px-4 py-2.5 last:border-b-0 hover:bg-muted/50 ${
                  change.isStaged ? 'bg-muted/50' : ''
                }`}
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('../lib/telemetryClient');
                    captureTelemetry('changes_viewed');
                  })();
                  setSelectedPath(change.path);
                  setShowDiffModal(true);
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="inline-flex items-center justify-center text-muted-foreground">
                    <FileIcon filename={change.path} isDirectory={false} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0 text-sm">{renderPath(change.path)}</div>
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
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={(e) => handleStageFile(change.path, e)}
                              disabled={stagingFiles.has(change.path)}
                            >
                              {stagingFiles.has(change.path) ? (
                                <Spinner size="sm" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
                          >
                            <p className="font-medium">Stage file for commit</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Add this file to the staging area so it will be included in the next
                              commit
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {change.isStaged && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={(e) => handleUnstageFile(change.path, e)}
                              disabled={unstagingFiles.has(change.path)}
                            >
                              {unstagingFiles.has(change.path) ? (
                                <Spinner size="sm" />
                              ) : (
                                <Minus className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
                          >
                            <p className="font-medium">Unstage file</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Remove this file from staging so it will not be included in the next
                              commit
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => confirmRevertFile(change.path, e)}
                            disabled={revertingFiles.has(change.path)}
                          >
                            {revertingFiles.has(change.path) ? (
                              <Spinner size="sm" />
                            ) : (
                              <Undo2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="max-w-xs border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
                        >
                          <p className="font-medium">Revert file changes</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Discard all uncommitted changes to this file and restore it to the last
                            committed version
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {showDiffModal && (
        <ChangesDiffModal
          open={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          taskId={resolvedTaskId}
          taskPath={resolvedTaskPath}
          files={fileChanges}
          initialFile={selectedPath}
          onRefreshChanges={refreshChanges}
          onToggleView={() => {
            setShowDiffModal(false);
            setShowAllChangesModal(true);
          }}
        />
      )}
      {showAllChangesModal && (
        <AllChangesDiffModal
          open={showAllChangesModal}
          onClose={() => setShowAllChangesModal(false)}
          taskPath={resolvedTaskPath}
          files={fileChanges}
          onRefreshChanges={refreshChanges}
          onOpenFile={(filePath) => {
            setShowAllChangesModal(false);
            setSelectedPath(filePath);
            setShowDiffModal(true);
          }}
          onToggleView={() => {
            setShowAllChangesModal(false);
            // If we have a selected path that exists in current changes, use it
            // Otherwise default to the first file
            const isValidSelection =
              selectedPath && fileChanges.some((f) => f.path === selectedPath);
            if (!isValidSelection && fileChanges.length > 0) {
              setSelectedPath(fileChanges[0].path);
            }
            setShowDiffModal(true);
          }}
        />
      )}
      <AlertDialog open={showMergeConfirm} onOpenChange={setShowMergeConfirm}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <AlertDialogTitle className="text-lg">Merge into main?</AlertDialogTitle>
            </div>
          </AlertDialogHeader>
          <div className="space-y-4">
            <AlertDialogDescription className="text-sm">
              This will merge your branch into main. This action may be difficult to reverse.
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowMergeConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowMergeConfirm(false);
                void handleMergeToMain();
              }}
              className="bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Merge into Main
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showRevertConfirm} onOpenChange={setShowRevertConfirm}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <AlertDialogTitle className="text-lg">Revert file?</AlertDialogTitle>
            </div>
          </AlertDialogHeader>
          <div className="space-y-4">
            <AlertDialogDescription className="text-sm">
              This will discard all uncommitted changes to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {revertTargetFile?.split('/').pop()}
              </code>{' '}
              and restore it to the last committed version. This action cannot be undone.
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowRevertConfirm(false);
                setRevertTargetFile(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRevertConfirm(false);
                void executeRevertFile();
              }}
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Revert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
export const FileChangesPanel = React.memo(FileChangesPanelComponent);

export default FileChangesPanel;
