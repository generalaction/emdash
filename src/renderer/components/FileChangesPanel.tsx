import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GitPlatform } from '../../shared/git/platform';
import { motion } from 'framer-motion';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
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
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  GitMerge,
  GitCommitHorizontal,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { useTaskScope } from './TaskScopeContext';
import { fetchPrBaseDiff, parseDiffToFileChanges } from '../lib/parsePrDiff';
import { formatDiffCount } from '../lib/gitChangePresentation';
import { getPlatformLabels } from '../lib/gitPlatformLabels';

type ActiveTab = 'changes' | 'checks';
type PrMode = 'create' | 'draft' | 'merge';

function getPrModeLabels(gitPlatform?: GitPlatform): Record<PrMode, string> {
  const labels = getPlatformLabels(gitPlatform);
  return {
    create: labels.createAction,
    draft: `Draft ${labels.prNoun}`,
    merge: 'Merge into Main',
  };
}

interface PrActionButtonProps {
  mode: PrMode;
  onModeChange: (mode: PrMode) => void;
  onExecute: () => Promise<void>;
  isLoading: boolean;
  isCreating?: boolean;
  modeLabels: Record<PrMode, string>;
}

function PrActionButton({
  mode,
  onModeChange,
  onExecute,
  isLoading,
  isCreating,
  modeLabels,
}: PrActionButtonProps) {
  return (
    <div className="flex shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="h-8 whitespace-nowrap rounded-r-none border-r-0 px-2 text-xs"
        disabled={isLoading}
        onClick={onExecute}
      >
        {isCreating ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner size="sm" />
            <span>Creating…</span>
          </span>
        ) : (
          modeLabels[mode]
        )}
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
                  {modeLabels[m]}
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
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

interface FileChangesPanelProps {
  taskId?: string;
  taskPath?: string;
  className?: string;
  onOpenChanges?: (filePath?: string, taskPath?: string, commitHash?: string) => void;
  gitPlatform?: GitPlatform;
}

const FileChangesPanelComponent: React.FC<FileChangesPanelProps> = ({
  taskId,
  taskPath,
  className,
  onOpenChanges,
  gitPlatform,
}) => {
  const platformLabels = getPlatformLabels(gitPlatform);
  const prModeLabels = getPrModeLabels(gitPlatform);
  const {
    taskId: scopedTaskId,
    taskPath: scopedTaskPath,
    prNumber: scopedPrNumber,
  } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const resolvedTaskPath = taskPath ?? scopedTaskPath;
  const safeTaskPath = resolvedTaskPath ?? '';
  const canRender = Boolean(resolvedTaskId && resolvedTaskPath);
  const taskPathRef = useRef(safeTaskPath);
  taskPathRef.current = safeTaskPath;

  const { pr, isLoading: isPrLoading, refresh: refreshPr } = usePrStatus(safeTaskPath);
  const effectivePrNumber = scopedPrNumber ?? pr?.number;
  const isPrReview = Boolean(scopedPrNumber && safeTaskPath);
  const [prDiffChanges, setPrDiffChanges] = useState<FileChange[]>([]);
  const [prDiffLoading, setPrDiffLoading] = useState(false);
  const [prBaseBranch, setPrBaseBranch] = useState<string | null>(null);
  const [prHeadBranch, setPrHeadBranch] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const hasFetchedPrDiff = useRef(false);

  const fetchPrDiff = useCallback(async () => {
    if (!effectivePrNumber || !safeTaskPath) return;
    setPrDiffLoading(true);
    try {
      const result = await fetchPrBaseDiff(safeTaskPath, effectivePrNumber);
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
  }, [effectivePrNumber, safeTaskPath]);

  useEffect(() => {
    hasFetchedPrDiff.current = false;
  }, [effectivePrNumber, safeTaskPath]);

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
  const hasChanges = fileChanges.length > 0;
  const stagedCount = fileChanges.filter((change) => change.isStaged).length;
  const hasStagedChanges = stagedCount > 0;
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
  const [branchDiffStats, setBranchDiffStats] = useState<{
    additions: number;
    deletions: number;
    files: number;
  } | null>(null);
  const [branchStatusLoading, setBranchStatusLoading] = useState<boolean>(false);
  const [changesOpen, setChangesOpen] = useState(true);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [branchCommits, setBranchCommits] = useState<
    Array<{ hash: string; subject: string; date: string }>
  >([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsFetched, setCommitsFetched] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<
    Record<string, Array<{ path: string; status: string; additions: number; deletions: number }>>
  >({});
  const [commitFilesLoading, setCommitFilesLoading] = useState<string | null>(null);

  // Reset action loading states when task changes
  useEffect(() => {
    setIsMergingToMain(false);
    setCommitMessage('');
    setStagingFiles(new Set());
    setRevertingFiles(new Set());
    setRestoreTarget(null);
    setIsStagingAll(false);
    setBranchAhead(null);
    setBranchDiffStats(null);
    // Reset commits section
    setBranchCommits([]);
    setCommitsFetched(false);
    setExpandedCommit(null);
    setCommitFiles({});
    setCommitsOpen(false);
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
          setBranchAhead(res?.success ? (res?.aheadOfDefault ?? res?.ahead ?? 0) : 0);
          setBranchDiffStats(res?.defaultDiffStats ?? null);
        }
      } catch {
        // Network or IPC error - default to 0
        if (!cancelled) {
          setBranchAhead(0);
          setBranchDiffStats(null);
        }
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

  // Fetch branch commits lazily when the commits section is first opened
  useEffect(() => {
    if (
      !commitsOpen ||
      commitsFetched ||
      !safeTaskPath ||
      branchAhead === null ||
      branchAhead === 0
    )
      return;

    let cancelled = false;
    setCommitsLoading(true);

    const load = async () => {
      try {
        const branchStatus = await window.electronAPI.getBranchStatus({
          taskPath: safeTaskPath,
          taskId: resolvedTaskId,
        });
        const defaultBranch = branchStatus?.defaultBranch;
        if (cancelled) return;

        const res = await window.electronAPI.gitGetLog({
          taskPath: safeTaskPath,
          maxCount: branchAhead,
          baseRef: defaultBranch || undefined,
        });
        if (!cancelled && res?.success && res.commits) {
          setBranchCommits(
            res.commits.map((c) => ({ hash: c.hash, subject: c.subject, date: c.date }))
          );
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setCommitsLoading(false);
          setCommitsFetched(true);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [commitsOpen, commitsFetched, safeTaskPath, branchAhead, resolvedTaskId]);

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
          setBranchAhead(bs?.success ? (bs?.aheadOfDefault ?? bs?.ahead ?? 0) : 0);
          setBranchDiffStats(bs?.defaultDiffStats ?? null);
          // Force commits section to re-fetch on next open
          setCommitsFetched(false);
          setBranchCommits([]);
          setCommitFiles({});
          setExpandedCommit(null);
        } catch {
          if (taskPathRef.current === taskPathAtCommit) {
            setBranchAhead(0);
            setBranchDiffStats(null);
          }
        } finally {
          if (taskPathRef.current === taskPathAtCommit) setBranchStatusLoading(false);
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
        gitPlatform,
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

  const handleToggleCommitFiles = useCallback(
    async (commitHash: string) => {
      if (expandedCommit === commitHash) {
        setExpandedCommit(null);
        return;
      }
      setExpandedCommit(commitHash);
      if (commitFiles[commitHash]) return;

      setCommitFilesLoading(commitHash);
      try {
        const res = await window.electronAPI.gitGetCommitFiles({
          taskPath: safeTaskPath,
          commitHash,
        });
        const files = res?.files;
        if (res?.success && files) {
          setCommitFiles((prev) => ({ ...prev, [commitHash]: files }));
        }
      } catch {
        // ignore
      } finally {
        setCommitFilesLoading(null);
      }
    },
    [expandedCommit, commitFiles, safeTaskPath]
  );

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

  const hasLocalChanges = fileChanges.length > 0;
  useEffect(() => {
    if (
      !isPrReview &&
      !hasLocalChanges &&
      !isLoading &&
      effectivePrNumber &&
      safeTaskPath &&
      !hasFetchedPrDiff.current
    ) {
      hasFetchedPrDiff.current = true;
      fetchPrDiff();
    }
  }, [isPrReview, hasLocalChanges, isLoading, effectivePrNumber, safeTaskPath, fetchPrDiff]);

  const showPrDiff = isPrReview || (!hasLocalChanges && prDiffChanges.length > 0);
  const displayChanges = showPrDiff ? prDiffChanges : fileChanges;
  const displayLoading = showPrDiff ? prDiffLoading : isLoading;

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
          title={`Open ${platformLabels.prNoun} on ${gitPlatform === 'gitlab' ? 'GitLab' : 'GitHub'}`}
        >
          <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate text-xs text-emerald-700 dark:text-emerald-300">
            Reviewing {platformLabels.prNoun} #{scopedPrNumber}
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
                  isCreating={isActionLoading}
                  modeLabels={prModeLabels}
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
              {branchDiffStats &&
              (branchDiffStats.additions > 0 || branchDiffStats.deletions > 0) ? (
                <>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    +{formatDiffCount(branchDiffStats.additions)}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{formatDiffCount(branchDiffStats.deletions)}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="text-muted-foreground">
                    {branchDiffStats.files} {branchDiffStats.files === 1 ? 'file' : 'files'}
                  </span>
                  {branchAhead != null && branchAhead > 0 && (
                    <>
                      <span className="text-muted-foreground">&middot;</span>
                      <span className="text-muted-foreground">
                        {branchAhead} {branchAhead === 1 ? 'commit' : 'commits'}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="font-medium text-green-600 dark:text-green-400">&mdash;</span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="font-medium text-red-600 dark:text-red-400">&mdash;</span>
                </>
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
                  title={`${pr.title || platformLabels.prNounFull} (#${pr.number})`}
                >
                  {pr.isDraft
                    ? 'Draft'
                    : String(pr.state).toUpperCase() === 'OPEN'
                      ? platformLabels.viewAction
                      : `${platformLabels.prNoun} ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
                  <ArrowUpRight className="size-3" />
                </button>
              ) : branchStatusLoading || (branchAhead !== null && branchAhead > 0) ? (
                <PrActionButton
                  mode={prMode}
                  onModeChange={selectPrMode}
                  onExecute={handlePrAction}
                  isLoading={isActionLoading || branchStatusLoading}
                  isCreating={isActionLoading}
                  modeLabels={prModeLabels}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  No {platformLabels.prNoun} for this task
                </span>
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
              gitPlatform={gitPlatform}
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
          {pr && (
            <MergePrSection
              taskPath={safeTaskPath}
              pr={pr}
              refreshPr={refreshPr}
              gitPlatform={gitPlatform}
            />
          )}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Changes section */}
          <Collapsible open={changesOpen} onOpenChange={setChangesOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
              {changesOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Changes
              {displayChanges.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {displayChanges.length}
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              {displayLoading && displayChanges.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="lg" className="text-muted-foreground" />
                </div>
              ) : showPrDiff ? (
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
                  {(() => {
                    const staged = fileChanges.filter((f) => f.isStaged);
                    const unstaged = fileChanges.filter((f) => !f.isStaged);
                    const renderFileRow = (change: FileChange) => (
                      <div
                        key={change.path}
                        className="flex cursor-pointer items-center justify-between border-b border-border/50 px-4 py-1.5 last:border-b-0 hover:bg-muted/50"
                        onClick={() => onOpenChanges?.(change.path, safeTaskPath)}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                          <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
                            <FileIcon filename={change.path} isDirectory={false} size={14} />
                          </span>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="min-w-0 truncate text-xs">
                              {renderPath(change.path, change.status)}
                            </div>
                          </div>
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1.5">
                          {change.status !== 'deleted' && shouldShowDiffPill(change.additions) && (
                            <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              +{formatDiffCount(change.additions)}
                            </span>
                          )}
                          {change.status !== 'deleted' && shouldShowDiffPill(change.deletions) && (
                            <span className="text-[10px] font-medium text-rose-700 dark:text-rose-300">
                              -{formatDiffCount(change.deletions)}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  onClick={(e) => handleFileStage(change.path, !change.isStaged, e)}
                                  disabled={
                                    stagingFiles.has(change.path) || revertingFiles.has(change.path)
                                  }
                                >
                                  {stagingFiles.has(change.path) ? (
                                    <Spinner size="sm" />
                                  ) : change.isStaged ? (
                                    <Minus className="h-3.5 w-3.5" />
                                  ) : (
                                    <Plus className="h-3.5 w-3.5" />
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
                                  className="h-6 w-6 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                                    <Undo2 className="h-3.5 w-3.5" />
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
                    );
                    return (
                      <>
                        {staged.length > 0 && (
                          <>
                            <div className="flex items-center justify-between px-4 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Staged ({staged.length})
                            </div>
                            {staged.map(renderFileRow)}
                          </>
                        )}
                        {unstaged.length > 0 && (
                          <>
                            <div className="flex items-center justify-between px-4 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Unstaged ({unstaged.length})
                            </div>
                            {unstaged.map(renderFileRow)}
                          </>
                        )}
                      </>
                    );
                  })()}
                </TooltipProvider>
              )}
              {!displayLoading && displayChanges.length === 0 && (
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  No uncommitted changes
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Commits section - only show when there are commits ahead */}
          {branchAhead != null && branchAhead > 0 && (
            <Collapsible open={commitsOpen} onOpenChange={setCommitsOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
                {commitsOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <GitCommitHorizontal className="h-3 w-3" />
                Commits
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {branchAhead}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {commitsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner size="sm" className="text-muted-foreground" />
                  </div>
                ) : branchCommits.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground">No commits</div>
                ) : (
                  branchCommits.map((commit) => (
                    <div key={commit.hash}>
                      <button
                        type="button"
                        className={`w-full border-b border-border/50 px-4 py-1.5 text-left hover:bg-muted/50 ${
                          expandedCommit === commit.hash ? 'bg-muted/30' : ''
                        }`}
                        onClick={() => void handleToggleCommitFiles(commit.hash)}
                      >
                        <div className="flex items-center gap-1.5">
                          {expandedCommit === commit.hash ? (
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs">{commit.subject}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatRelativeDate(commit.date)}
                          </span>
                        </div>
                      </button>
                      {expandedCommit === commit.hash && (
                        <div className="border-b border-border/50 bg-muted/20">
                          {commitFilesLoading === commit.hash ? (
                            <div className="flex items-center justify-center py-3">
                              <Spinner size="sm" className="text-muted-foreground" />
                            </div>
                          ) : commitFiles[commit.hash]?.length ? (
                            (() => {
                              const files = commitFiles[commit.hash];
                              const grouped: Record<string, typeof files> = {};
                              for (const file of files) {
                                const lastSlash = file.path.lastIndexOf('/');
                                const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '.';
                                (grouped[dir] ??= []).push(file);
                              }
                              return Object.entries(grouped).map(([dir, dirFiles]) => (
                                <div key={dir}>
                                  <div className="px-4 py-1 pl-9 text-[10px] font-medium text-muted-foreground">
                                    {dir}
                                  </div>
                                  {dirFiles.map((file) => (
                                    <button
                                      key={file.path}
                                      type="button"
                                      className="flex w-full items-center gap-2 px-4 py-1 pl-12 text-left hover:bg-muted/50"
                                      onClick={() =>
                                        onOpenChanges?.(file.path, safeTaskPath, commit.hash)
                                      }
                                    >
                                      <FileIcon
                                        filename={file.path}
                                        isDirectory={false}
                                        size={14}
                                      />
                                      <span className="min-w-0 flex-1 truncate text-xs">
                                        {file.path.split('/').pop()}
                                      </span>
                                      {file.additions > 0 && (
                                        <span className="text-[10px] text-green-600 dark:text-green-400">
                                          +{file.additions}
                                        </span>
                                      )}
                                      {file.deletions > 0 && (
                                        <span className="text-[10px] text-red-600 dark:text-red-400">
                                          -{file.deletions}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              ));
                            })()
                          ) : (
                            <div className="px-4 py-2 pl-9 text-xs text-muted-foreground">
                              No files
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
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
    </div>
  );
};
export const FileChangesPanel = React.memo(FileChangesPanelComponent);

export default FileChangesPanel;
