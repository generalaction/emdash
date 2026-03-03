import React, { useEffect, useRef, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { useCreatePR } from '../hooks/useCreatePR';
import { useFileChanges } from '../hooks/useFileChanges';
import { usePrStatus } from '../hooks/usePrStatus';
import { useCheckRuns } from '../hooks/useCheckRuns';
import { useAutoCheckRunsRefresh } from '../hooks/useAutoCheckRunsRefresh';
import { usePrComments } from '../hooks/usePrComments';
import { ChecksPanel } from './CheckRunsList';
import { PrCommentsList } from './PrCommentsList';
import MergePrSection from './MergePrSection';
import { FileIcon } from './FileExplorer/FileIcons';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Close as PopoverClose } from '@radix-ui/react-popover';
import {
  ArrowUpRight,
  ChevronDown,
  FileDiff,
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
  const { taskId: scopedTaskId, taskPath: scopedTaskPath } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const resolvedTaskPath = taskPath ?? scopedTaskPath;
  const safeTaskPath = resolvedTaskPath ?? '';
  const canRender = Boolean(resolvedTaskId && resolvedTaskPath);

  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showAllChangesModal, setShowAllChangesModal] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);

  // Reset selectedPath and action loading states when task changes
  useEffect(() => {
    setSelectedPath(undefined);
    setIsMergingToMain(false);
  }, [resolvedTaskPath]);
  const [stagingFiles, setStagingFiles] = useState<Set<string>>(new Set());
  const [unstagingFiles, setUnstagingFiles] = useState<Set<string>>(new Set());
  const [revertingFiles, setRevertingFiles] = useState<Set<string>>(new Set());
  const [isStagingAll, setIsStagingAll] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isMergingToMain, setIsMergingToMain] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
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

  const { fileChanges, isLoading, refreshChanges } = useFileChanges(safeTaskPath);
  const { toast } = useToast();
  const hasChanges = fileChanges.length > 0;
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
        <span className="shrink-0 font-medium text-foreground">{base}</span>
        {dir && <span className="ml-1 truncate text-muted-foreground">{dir}</span>}
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

  const isActionLoading = isCreatingForTaskPath(safeTaskPath) || isMergingToMain;

  return (
    <div className={`flex h-full flex-col bg-card shadow-sm ${className}`}>
      <div className="bg-muted px-3 py-2">
        {hasChanges ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex shrink-0 items-center gap-1 text-xs">
              <span className="font-medium text-green-600 dark:text-green-400">
                +{totalChanges.additions}
              </span>
              <span className="text-muted-foreground">&middot;</span>
              <span className="font-medium text-red-600 dark:text-red-400">
                -{totalChanges.deletions}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
              <PrActionButton
                mode={prMode}
                onModeChange={selectPrMode}
                onExecute={handlePrAction}
                isLoading={isActionLoading}
              />
            </div>
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
                className="flex cursor-pointer items-center justify-between border-b border-border/50 px-4 py-2.5 last:border-b-0 hover:bg-muted/50"
                onClick={() => onOpenChanges?.(change.path, safeTaskPath)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                  <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
                    <FileIcon filename={change.path} isDirectory={false} size={16} />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="min-w-0 truncate text-sm">{renderPath(change.path)}</div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-green-900/30 dark:text-emerald-300">
                    +{change.additions}
                  </span>
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                    -{change.deletions}
                  </span>
                </div>
              </div>
            ))
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
    </div>
  );
};
export const FileChangesPanel = React.memo(FileChangesPanelComponent);

export default FileChangesPanel;
