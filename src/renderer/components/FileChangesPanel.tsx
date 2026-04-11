import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { useErrorDetails } from '../hooks/useErrorDetails';
import { friendlyGitError } from '../lib/friendlyGitError';
import { useCreatePR } from '../hooks/useCreatePR';
import { useFileChanges, type FileChange } from '../hooks/useFileChanges';
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
  GitPullRequest,
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
import { fetchPrBaseDiff, parseDiffToFileChanges } from '../lib/parsePrDiff';
import { formatDiffCount } from '../lib/gitChangePresentation';

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
    <div className="flex shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="h-8 whitespace-nowrap rounded-r-none border-r-0 px-2 text-xs"
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
  onOpenChanges?: (filePath?: string, taskPath?: string) => void;
}

const FileChangesPanelComponent: React.FC<FileChangesPanelProps> = ({
  taskId,
  taskPath,
  className,
  onOpenChanges,
}) => {
  const { taskId: scopedTaskId, taskPath: scopedTaskPath, prNumber } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const resolvedTaskPath = taskPath ?? scopedTaskPath;
  const safeTaskPath = resolvedTaskPath ?? '';
  const canRender = Boolean(resolvedTaskId && resolvedTaskPath);
  const taskPathRef = useRef(safeTaskPath);
  taskPathRef.current = safeTaskPath;

  // PR review mode state
  const [prDiffChanges, setPrDiffChanges] = useState<FileChange[]>([]);
  const [prDiffLoading, setPrDiffLoading] = useState(false);
  const [prBaseBranch, setPrBaseBranch] = useState<string | null>(null);
  const [prHeadBranch, setPrHeadBranch] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const isPrReview = Boolean(prNumber && safeTaskPath);

  const fetchPrDiff = useCallback(async () => {
    if (!prNumber || !safeTaskPath) return;
    setPrDiffLoading(true);
    try {
      const result = await fetchPrBaseDiff(safeTaskPath, prNumber);
      if (result.success) {
        setPrDiffChanges(parseDiffToFileChanges(result.diff ?? ''));
        setPrBaseBranch(result.baseBranch || null);
        setPrHeadBranch(result.headBranch || null);
        setPrUrl(result.prUrl || null);
      } else {
        setPrDiffChanges([]);
        setPrBaseBranch(null);
        setPrHeadBranch(null);
        setPrUrl(null);
        if (result.error) {
          console.error('Failed to load PR diff:', result.error);
        }
      }
    } catch (err) {
      setPrDiffChanges([]);
      setPrBaseBranch(null);
      setPrHeadBranch(null);
      setPrUrl(null);
      console.error('Failed to load PR diff:', err);
    } finally {
      setPrDiffLoading(false);
    }
  }, [prNumber, safeTaskPath]);

  useEffect(() => {
    if (isPrReview) {
      fetchPrDiff();
    }
  }, [isPrReview, fetchPrDiff]);

  const [stagingFiles, setStagingFiles] = useState<Set<string>>(new Set());
  const [revertingFiles, setRevertingFiles] = useState<Set<string>>(new Set());
  const [isStagingAll, setIsStagingAll] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isMergingToMain, setIsMergingToMain] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
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
  const { isCreatingForTaskPath, createPR } = useCreatePR();

  const selectPrMode = (mode: PrMode) => {
    setPrMode(mode);
    try {
      localStorage.setItem('emdash:prMode', mode);
    } catch {
      // localStorage not available
    }
  };

  const { fileChanges, isLoading, refreshChanges } = useFileChanges(safeTaskPath, {
    taskId: resolvedTaskId,
  });
  const { toast } = useToast();
  const { showError, errorDialog } = useErrorDetails();
  const hasChanges = fileChanges.length > 0;
  const stagedCount = fileChanges.filter((change) => change.isStaged).length;
  const hasStagedChanges = stagedCount > 0;
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

  // Reset action loading states when task changes
  useEffect(() => {
    setIsMergingToMain(false);
    setCommitMessage('');
    setStagingFiles(new Set());
    setRevertingFiles(new Set());
    setRestoreTarget(null);
    setIsStagingAll(false);
  }, [resolvedTaskPath]);

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

      setBranchStatusLoading(true);
      try {
        const res = await window.electronAPI.getBranchStatus({
          taskPath: safeTaskPath,
          taskId: resolvedTaskId,
        });
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

  const handleFileStage = async (filePath: string, stage: boolean, event: React.MouseEvent) => {
    event.stopPropagation();
    setStagingFiles((prev) => new Set(prev).add(filePath));
    try {
      await window.electronAPI.updateIndex({
        taskPath: safeTaskPath,
        taskId: resolvedTaskId,
        action: stage ? 'stage' : 'unstage',
        scope: 'paths',
        filePaths: [filePath],
      });
    } catch (err) {
      console.error('Staging failed:', err);
      toast({
        title: stage ? 'Stage Failed' : 'Unstage Failed',
        description:
          err instanceof Error ? err.message : 'Could not update the file staging status.',
        variant: 'destructive',
      });
    } finally {
      setStagingFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      await refreshChanges();
    }
  };

  const handleStageAll = async () => {
    setIsStagingAll(true);
    try {
      await window.electronAPI.updateIndex({
        taskPath: safeTaskPath,
        taskId: resolvedTaskId,
        action: 'stage',
        scope: 'all',
      });
    } catch (err) {
      console.error('Stage all failed:', err);
      toast({
        title: 'Stage All Failed',
        description: 'Could not stage all files.',
        variant: 'destructive',
      });
    } finally {
      setIsStagingAll(false);
      await refreshChanges();
    }
  };

  const executeRestore = async () => {
    const filePath = restoreTarget;
    if (!filePath) return;
    setRestoreTarget(null);
    setRevertingFiles((prev) => new Set(prev).add(filePath));
    try {
      await window.electronAPI.revertFile({
        taskPath: safeTaskPath,
        taskId: resolvedTaskId,
        filePath,
      });
      dispatchFileChangeEvent(safeTaskPath, filePath);
    } catch (err) {
      console.error('Restore failed:', err);
      toast({
        title: 'Revert Failed',
        description: 'Could not revert the file.',
        variant: 'destructive',
      });
    } finally {
      setRevertingFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      await refreshChanges();
    }
  };

  const handleCommitAndPush = async () => {
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage) {
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
        taskId: resolvedTaskId,
        commitMessage: trimmedMessage,
        createBranchIfOnDefault: true,
      });

      if (result.success) {
        const taskPathAtCommit = safeTaskPath;
        toast({
          title: 'Committed and Pushed',
          description: `Changes committed with message: "${trimmedMessage}"`,
        });
        setCommitMessage('');
        await refreshChanges();
        // Guard remaining updates against task switch during async chain
        if (taskPathRef.current !== taskPathAtCommit) return;
        try {
          await refreshPr();
        } catch {
          // PR refresh is best-effort
        }
        if (taskPathRef.current !== taskPathAtCommit) return;
        // Reload branch status so the Create PR button appears immediately
        try {
          setBranchStatusLoading(true);
          const bs = await window.electronAPI.getBranchStatus({
            taskPath: taskPathAtCommit,
            taskId: resolvedTaskId,
          });
          if (taskPathRef.current !== taskPathAtCommit) return;
          setBranchAhead(bs?.success ? (bs?.ahead ?? 0) : 0);
        } catch {
          if (taskPathRef.current === taskPathAtCommit) setBranchAhead(0);
        } finally {
          if (taskPathRef.current === taskPathAtCommit) setBranchStatusLoading(false);
        }
      } else {
        showError(
          'Commit Failed',
          typeof result.error === 'string' ? result.error : 'Failed to commit and push changes.',
          { summarize: friendlyGitError }
        );
      }
    } catch (error) {
      showError('Commit Failed', error instanceof Error ? error.message : String(error), {
        summarize: friendlyGitError,
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const handleMergeToMain = async () => {
    setIsMergingToMain(true);
    try {
      const result = await window.electronAPI.mergeToMain({
        taskPath: safeTaskPath,
        taskId: resolvedTaskId,
      });
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
        captureTelemetry('pr_created');
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

  const renderPath = (p: string, status?: FileChange['status']) => {
    const last = p.lastIndexOf('/');
    const dir = last >= 0 ? p.slice(0, last + 1) : '';
    const base = last >= 0 ? p.slice(last + 1) : p;
    const isDeleted = status === 'deleted';
    return (
      <span className="flex min-w-0" title={p}>
        <span
          className={['shrink-0 font-medium text-foreground', isDeleted ? 'line-through' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {base}
        </span>
        {dir && (
          <span
            className={['ml-1 truncate text-muted-foreground', isDeleted ? 'line-through' : '']
              .filter(Boolean)
              .join(' ')}
          >
            {dir}
          </span>
        )}
      </span>
    );
  };

  const shouldShowDiffPill = (value: number | null | undefined) =>
    typeof value === 'number' && value !== 0;

  // Use PR diff changes when in PR review mode, otherwise use local file changes
  const displayChanges = isPrReview ? prDiffChanges : fileChanges;
  const displayLoading = isPrReview ? prDiffLoading : isLoading;

  const totalChanges = displayChanges.reduce<{
    additions: number | null;
    deletions: number | null;
  }>(
    (acc, change) => ({
      additions:
        acc.additions === null || change.additions === null
          ? null
          : acc.additions + change.additions,
      deletions:
        acc.deletions === null || change.deletions === null
          ? null
          : acc.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  if (!canRender) {
    return null;
  }

  const isActionLoading = isCreatingForTaskPath(safeTaskPath) || isMergingToMain;
  const hasDisplayChanges = displayChanges.length > 0;

  return (
    <div className={`flex h-full flex-col bg-card shadow-sm ${className ?? ''}`}>
      {/* PR review banner */}
      {isPrReview && (
        <motion.button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left transition-colors hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            const url = prUrl || pr?.url;
            if (url) window.electronAPI.openExternal(url);
          }}
          title="Open PR on GitHub"
        >
          <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate text-xs text-emerald-700 dark:text-emerald-300">
            Reviewing PR #{prNumber}
            {prHeadBranch && prBaseBranch && (
              <>
                {': '}
                <span className="font-mono font-medium">{prHeadBranch}</span>
                {' \u2192 '}
                <span className="font-mono font-medium">{prBaseBranch}</span>
              </>
            )}
          </span>
          <ArrowUpRight className="h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
        </motion.button>
      )}

      <div className="bg-muted px-3 py-2">
        {isPrReview ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex shrink-0 items-center gap-1 text-xs">
              {hasDisplayChanges ? (
                <>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    +{formatDiffCount(totalChanges.additions)}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{formatDiffCount(totalChanges.deletions)}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="text-muted-foreground">
                    {displayChanges.length} {displayChanges.length === 1 ? 'file' : 'files'}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium text-green-600 dark:text-green-400">&mdash;</span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="font-medium text-red-600 dark:text-red-400">&mdash;</span>
                </>
              )}
            </div>
            {onOpenChanges && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                title="View all changes and history"
                onClick={() => onOpenChanges(undefined, safeTaskPath)}
              >
                <FileDiff className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Changes</span>
              </Button>
            )}
          </div>
        ) : hasChanges ? (
          <div className="space-y-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex shrink-0 items-center gap-1 text-xs">
                  <span className="font-medium text-green-600 dark:text-green-400">
                    +{formatDiffCount(totalChanges.additions)}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{formatDiffCount(totalChanges.deletions)}
                  </span>
                </div>
                {hasStagedChanges && (
                  <span className="shrink-0 rounded bg-muted-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {stagedCount} staged
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {onOpenChanges && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    title="View all changes and history"
                    onClick={() => onOpenChanges(undefined, safeTaskPath)}
                  >
                    <FileDiff className="h-3.5 w-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Changes</span>
                  </Button>
                )}
                {fileChanges.some((f) => !f.isStaged) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    title="Stage all files for commit"
                    onClick={handleStageAll}
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
                      void handleCommitAndPush();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  title="Commit all staged changes and push"
                  onClick={() => void handleCommitAndPush()}
                  disabled={isCommitting || !commitMessage.trim()}
                >
                  {isCommitting ? <Spinner size="sm" /> : 'Commit & Push'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex shrink-0 items-center gap-1 text-xs">
              <span className="font-medium text-green-600 dark:text-green-400">&mdash;</span>
              <span className="text-muted-foreground">&middot;</span>
              <span className="font-medium text-red-600 dark:text-red-400">&mdash;</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {onOpenChanges && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-xs"
                  title="View all changes and history"
                  onClick={() => onOpenChanges(undefined, safeTaskPath)}
                >
                  <FileDiff className="mr-1.5 h-3.5 w-3.5" />
                  Changes
                </Button>
              )}
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

      {pr && hasChanges && !isPrReview && (
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

      {/* PR review mode: tabs for PR diff + checks */}
      {isPrReview && (
        <div className="flex border-b border-border">
          <TabButton active={activeTab === 'changes'} onClick={() => setActiveTab('changes')}>
            PR Diff
            {hasDisplayChanges && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                {displayChanges.length}
              </span>
            )}
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

      {activeTab === 'checks' && (pr || isPrReview) ? (
        <>
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
              hasPr={!!pr || isPrReview}
              hideSummary={isPrReview ? !hasDisplayChanges : !hasChanges}
            />
            {pr && (
              <PrCommentsList
                status={prCommentsStatus}
                isLoading={prCommentsLoading}
                hasPr={!!pr}
                prUrl={pr?.url}
              />
            )}
          </div>
          {pr && <MergePrSection taskPath={safeTaskPath} pr={pr} refreshPr={refreshPr} />}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {displayLoading && displayChanges.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="lg" className="text-muted-foreground" />
            </div>
          ) : isPrReview ? (
            displayChanges.map((change, index) => (
              <div
                key={index}
                className="flex cursor-pointer items-center justify-between border-b border-border/50 px-4 py-2.5 last:border-b-0 hover:bg-muted/50"
                onClick={() => onOpenChanges?.(change.path, safeTaskPath)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                  <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
                    <FileIcon filename={change.path} isDirectory={false} size={16} />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="min-w-0 truncate text-sm">
                      {renderPath(change.path, change.status)}
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {change.status !== 'deleted' && shouldShowDiffPill(change.additions) && (
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-green-900/30 dark:text-emerald-300">
                      +{formatDiffCount(change.additions)}
                    </span>
                  )}
                  {change.status !== 'deleted' && shouldShowDiffPill(change.deletions) && (
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                      -{formatDiffCount(change.deletions)}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <TooltipProvider delayDuration={100}>
              {fileChanges.map((change) => (
                <div
                  key={change.path}
                  className={`flex cursor-pointer items-center justify-between border-b border-border/50 px-4 py-2.5 last:border-b-0 hover:bg-muted/50 ${
                    change.isStaged ? 'bg-muted/50' : ''
                  }`}
                  onClick={() => onOpenChanges?.(change.path, safeTaskPath)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
                      <FileIcon filename={change.path} isDirectory={false} size={16} />
                    </span>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="min-w-0 truncate text-sm">
                        {renderPath(change.path, change.status)}
                      </div>
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    {change.status !== 'deleted' && shouldShowDiffPill(change.additions) && (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-green-900/30 dark:text-emerald-300">
                        +{formatDiffCount(change.additions)}
                      </span>
                    )}
                    {change.status !== 'deleted' && shouldShowDiffPill(change.deletions) && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        -{formatDiffCount(change.deletions)}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => handleFileStage(change.path, !change.isStaged, e)}
                            disabled={
                              stagingFiles.has(change.path) || revertingFiles.has(change.path)
                            }
                          >
                            {stagingFiles.has(change.path) ? (
                              <Spinner size="sm" />
                            ) : change.isStaged ? (
                              <Minus className="h-4 w-4" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="max-w-xs border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
                        >
                          <p className="font-medium">
                            {change.isStaged ? 'Unstage file' : 'Stage file for commit'}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRestoreTarget(change.path);
                            }}
                            disabled={
                              stagingFiles.has(change.path) || revertingFiles.has(change.path)
                            }
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
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </TooltipProvider>
          )}
        </div>
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
      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">Revert file?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription className="text-sm">
            This will discard all uncommitted changes to{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {restoreTarget?.split('/').pop()}
            </code>{' '}
            and restore it to the last committed version. This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeRestore()}
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Revert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {errorDialog}
    </div>
  );
};
export const FileChangesPanel = React.memo(FileChangesPanelComponent);

export default FileChangesPanel;
