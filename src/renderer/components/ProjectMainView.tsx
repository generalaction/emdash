import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import {
  GitBranch,
  Plus,
  Loader2,
  ChevronDown,
  ArrowUpRight,
  Folder,
  AlertCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Separator } from './ui/separator';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';
import { Spinner } from './ui/spinner';
import TaskDeleteButton from './TaskDeleteButton';
import ProjectDeleteButton from './ProjectDeleteButton';
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
import { Checkbox } from './ui/checkbox';
import BaseBranchControls, { RemoteBranchOption } from './BaseBranchControls';
import { useToast } from '../hooks/use-toast';
import ContainerStatusBadge from './ContainerStatusBadge';
import TaskPorts from './TaskPorts';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import dockerLogo from '../../assets/images/docker.png';
import DeletePrNotice from './DeletePrNotice';
import {
  getContainerRunState,
  startContainerRun,
  subscribeToTaskRunState,
  type ContainerRunState,
} from '@/lib/containerRuns';
import { activityStore } from '../lib/activityStore';
import PrPreviewTooltip from './PrPreviewTooltip';
import { isActivePr, PrInfo } from '../lib/prStatus';
import { refreshPrStatus } from '../lib/prStatusStore';
import type { Project, Task } from '../types/app';

const normalizeBaseRef = (ref?: string | null): string | undefined => {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function TaskRow({
  ws,
  active,
  onClick,
  onDelete,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  ws: Task;
  active: boolean;
  onClick: () => void;
  onDelete: () => void | Promise<void | boolean>;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { pr } = usePrStatus(ws.path);
  const { totalAdditions, totalDeletions, isLoading } = useTaskChanges(ws.path, ws.id);
  const [containerState, setContainerState] = useState<ContainerRunState | undefined>(() =>
    getContainerRunState(ws.id)
  );
  const [isStartingContainer, setIsStartingContainer] = useState(false);
  const [isStoppingContainer, setIsStoppingContainer] = useState(false);
  const containerStatus = containerState?.status;
  const isReady = containerStatus === 'ready';
  const isStartingContainerState = containerStatus === 'building' || containerStatus === 'starting';
  const containerActive = isStartingContainerState || isReady;
  const [expanded, setExpanded] = useState(false);
  const [hasComposeFile, setHasComposeFile] = useState(false);

  // Check for docker-compose files - if present, disable Connect button
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const candidates = [
          'docker-compose.build.yml',
          'docker-compose.dev.yml',
          'docker-compose.yml',
          'docker-compose.yaml',
          'compose.yml',
          'compose.yaml',
        ];
        for (const file of candidates) {
          const res = await api?.fsRead?.(ws.path, file, 1);
          if (!cancelled && res?.success) {
            setHasComposeFile(true);
            return;
          }
        }
        if (!cancelled) setHasComposeFile(false);
      } catch {
        if (!cancelled) setHasComposeFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws.path]);

  useEffect(() => {
    if (isReady && (containerState?.ports?.length ?? 0) > 0) {
      setExpanded(true);
    }
    if (!containerActive) {
      setExpanded(false);
    }
  }, [isReady, containerActive, containerState?.ports?.length]);

  useEffect(() => {
    const off = activityStore.subscribe(ws.id, (busy) => setIsRunning(busy));
    return () => {
      off?.();
    };
  }, [ws.id]);

  useEffect(() => {
    const off = subscribeToTaskRunState(ws.id, (state) => setContainerState(state));
    return () => {
      off?.();
    };
  }, [ws.id]);

  // On mount, try to hydrate state by inspecting existing compose stack
  useEffect(() => {
    (async () => {
      try {
        const mod = await import('@/lib/containerRuns');
        await mod.refreshTaskRunState(ws.id);
      } catch {}
    })();
  }, [ws.id]);

  const handleStartContainer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsStartingContainer(true);
      const res = await startContainerRun({
        taskId: ws.id,
        taskPath: ws.path,
        mode: 'container',
      });
      if (res?.ok !== true) {
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('container_connect_failed', {
            error_type: res?.error?.code || 'unknown',
          });
        });
        toast({
          title: 'Failed to start container',
          description: res?.error?.message || 'Unknown error',
          variant: 'destructive',
        });
      } else {
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('container_connect_success');
        });
      }
    } catch (error: any) {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('container_connect_failed', { error_type: 'exception' });
      });
      toast({
        title: 'Failed to start container',
        description: error?.message || String(error),
        variant: 'destructive',
      });
    } finally {
      setIsStartingContainer(false);
    }
  };

  const handleStopContainer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsStoppingContainer(true);
      const res = await (window as any).electronAPI.stopContainerRun(ws.id);
      if (!res?.ok) {
        toast({
          title: 'Failed to stop container',
          description: res?.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Failed to stop container',
        description: error?.message || String(error),
        variant: 'destructive',
      });
    } finally {
      setIsStoppingContainer(false);
    }
  };

  const ports = containerState?.ports ?? [];
  const previewUrl = containerState?.previewUrl;
  const previewService = containerState?.previewService;

  const handleRowClick = () => {
    if (!isSelectMode) {
      onClick();
    }
  };

  return (
    <div
      className={[
        'overflow-hidden rounded-xl border bg-background',
        active && !isSelectMode ? 'border-primary' : 'border-border',
      ].join(' ')}
    >
      <div
        onClick={handleRowClick}
        role="button"
        tabIndex={0}
        className={[
          'group flex items-start justify-between gap-3 rounded-t-xl',
          'px-4 py-3 transition-all hover:bg-muted/40 hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        ].join(' ')}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-medium leading-tight tracking-tight">{ws.name}</div>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {isRunning || ws.status === 'running' ? <Spinner size="sm" className="size-3" /> : null}
            <GitBranch className="size-3" />
            <span className="max-w-[24rem] truncate font-mono" title={`origin/${ws.branch}`}>
              origin/{ws.branch}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
            <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
          ) : null}

          {ws.metadata?.multiAgent?.enabled ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-8 cursor-not-allowed items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium opacity-50"
                    aria-label="Connect disabled for multi-agent tasks"
                  >
                    <img src={dockerLogo} alt="Docker" className="mr-1.5 h-3.5 w-3.5" />
                    Connect
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
                  Docker containerization is not available for multi-agent tasks.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : hasComposeFile ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-8 cursor-not-allowed items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium opacity-50"
                    aria-label="Connect disabled for Docker Compose projects"
                  >
                    <img src={dockerLogo} alt="Docker" className="mr-1.5 h-3.5 w-3.5" />
                    Connect
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
                  Docker Compose (multi‑service) containerization is coming soon.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <ContainerStatusBadge
              active={containerActive}
              isStarting={isStartingContainerState}
              isReady={isReady}
              startingAction={isStartingContainer}
              stoppingAction={isStoppingContainer}
              onStart={handleStartContainer}
              onStop={handleStopContainer}
              taskPath={ws.path}
            />
          )}
          {containerActive ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium"
              aria-expanded={expanded}
              aria-controls={`ws-${ws.id}-ports`}
            >
              <ChevronDown
                className={['h-3.5 w-3.5 transition-transform', expanded ? 'rotate-180' : ''].join(
                  ' '
                )}
                aria-hidden="true"
              />
              Ports
            </button>
          ) : null}
          {!isLoading && totalAdditions === 0 && totalDeletions === 0 && pr ? (
            <PrPreviewTooltip pr={pr} side="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pr.url) window.electronAPI.openExternal(pr.url);
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
            </PrPreviewTooltip>
          ) : null}

          {isSelectMode ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect?.()}
              aria-label={`Select ${ws.name}`}
              className="h-4 w-4 rounded border-muted-foreground/50 data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground"
            />
          ) : (
            <>
              <TaskDeleteButton
                taskName={ws.name}
                taskId={ws.id}
                taskPath={ws.path}
                onConfirm={async () => {
                  try {
                    setIsDeleting(true);
                    await onDelete();
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                isDeleting={isDeleting}
                aria-label={`Delete task ${ws.name}`}
                className="inline-flex items-center justify-center rounded p-2 text-muted-foreground hover:bg-transparent focus-visible:ring-0"
              />
            </>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {containerActive && expanded ? (
          <TaskPorts
            key={`ports-${ws.id}`}
            taskId={ws.id}
            taskPath={ws.path}
            ports={ports}
            previewUrl={previewUrl}
            previewService={previewService}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface ProjectMainViewProps {
  project: Project;
  onCreateTask: () => void;
  activeTask: Task | null;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  isCreatingTask?: boolean;
  onDeleteProject?: (project: Project) => void | Promise<void>;
}

const ProjectMainView: React.FC<ProjectMainViewProps> = ({
  project,
  onCreateTask,
  activeTask,
  onSelectTask,
  onDeleteTask,
  isCreatingTask = false,
  onDeleteProject,
}) => {
  const { toast } = useToast();

  const [baseBranch, setBaseBranch] = useState<string | undefined>(() =>
    normalizeBaseRef(project.gitInfo.baseRef)
  );
  const [branchOptions, setBranchOptions] = useState<RemoteBranchOption[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSavingBaseBranch, setIsSavingBaseBranch] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null);
  const [branchReloadToken, setBranchReloadToken] = useState(0);

  // Multi-select state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [acknowledgeDirtyDelete, setAcknowledgeDirtyDelete] = useState(false);

  const tasksInProject = project.tasks ?? [];
  const selectedCount = selectedIds.size;
  const selectedTasks = useMemo(
    () => tasksInProject.filter((ws) => selectedIds.has(ws.id)),
    [selectedIds, tasksInProject]
  );
  const [deleteStatus, setDeleteStatus] = useState<
    Record<
      string,
      {
        staged: number;
        unstaged: number;
        untracked: number;
        ahead: number;
        behind: number;
        error?: string;
        pr?: PrInfo | null;
      }
    >
  >({});
  const [deleteStatusLoading, setDeleteStatusLoading] = useState(false);
  const deleteRisks = useMemo(() => {
    const riskyIds = new Set<string>();
    const summaries: Record<string, string> = {};
    for (const ws of selectedTasks) {
      const status = deleteStatus[ws.id];
      if (!status) continue;
      const dirty =
        status.staged > 0 ||
        status.unstaged > 0 ||
        status.untracked > 0 ||
        status.ahead > 0 ||
        !!status.error ||
        (status.pr && isActivePr(status.pr));
      if (dirty) {
        riskyIds.add(ws.id);
        const parts: string[] = [];
        if (status.staged > 0)
          parts.push(`${status.staged} ${status.staged === 1 ? 'file' : 'files'} staged`);
        if (status.unstaged > 0)
          parts.push(`${status.unstaged} ${status.unstaged === 1 ? 'file' : 'files'} unstaged`);
        if (status.untracked > 0)
          parts.push(`${status.untracked} ${status.untracked === 1 ? 'file' : 'files'} untracked`);
        if (status.ahead > 0)
          parts.push(`ahead by ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}`);
        if (status.behind > 0)
          parts.push(`behind by ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}`);
        if (status.pr && isActivePr(status.pr)) parts.push('PR open');
        if (!parts.length && status.error) parts.push('status unavailable');
        summaries[ws.id] = parts.join(', ');
      }
    }
    return { riskyIds, summaries };
  }, [deleteStatus, selectedTasks]);
  const deleteDisabled: boolean =
    Boolean(isDeleting || deleteStatusLoading) ||
    (deleteRisks.riskyIds.size > 0 && acknowledgeDirtyDelete !== true);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    const toDelete = tasksInProject.filter((ws) => selectedIds.has(ws.id));
    if (toDelete.length === 0) return;

    setIsDeleting(true);
    setShowDeleteDialog(false);

    const deletedNames: string[] = [];
    for (const ws of toDelete) {
      try {
        const result = await onDeleteTask(project, ws, { silent: true });
        if (result !== false) {
          deletedNames.push(ws.name);
        }
      } catch {
        // Continue deleting remaining tasks
      }
    }

    setIsDeleting(false);
    exitSelectMode();

    if (deletedNames.length > 0) {
      const maxNames = 3;
      const displayNames = deletedNames.slice(0, maxNames).join(', ');
      const remaining = deletedNames.length - maxNames;

      toast({
        title: deletedNames.length === 1 ? 'Task deleted' : 'Tasks deleted',
        description: remaining > 0 ? `${displayNames} and ${remaining} more` : displayNames,
      });
    }
  };

  // Reset select mode when project changes
  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, [project.id]);

  useEffect(() => {
    setBaseBranch(normalizeBaseRef(project.gitInfo.baseRef));
  }, [project.id, project.gitInfo.baseRef]);

  useEffect(() => {
    if (!showDeleteDialog) {
      setDeleteStatus({});
      setAcknowledgeDirtyDelete(false);
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      setDeleteStatusLoading(true);
      const next: typeof deleteStatus = {};

      for (const ws of selectedTasks) {
        try {
          const [statusRes, infoRes, rawPr] = await Promise.allSettled([
            window.electronAPI.getGitStatus(ws.path),
            window.electronAPI.getGitInfo(ws.path),
            refreshPrStatus(ws.path),
          ]);

          let staged = 0;
          let unstaged = 0;
          let untracked = 0;
          if (
            statusRes.status === 'fulfilled' &&
            statusRes.value?.success &&
            statusRes.value.changes
          ) {
            for (const change of statusRes.value.changes) {
              if (change.status === 'untracked') {
                untracked += 1;
              } else if (change.isStaged) {
                staged += 1;
              } else {
                unstaged += 1;
              }
            }
          }

          const ahead =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.aheadCount === 'number'
              ? infoRes.value.aheadCount
              : 0;
          const behind =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.behindCount === 'number'
              ? infoRes.value.behindCount
              : 0;
          const prValue = rawPr.status === 'fulfilled' ? rawPr.value : null;
          const pr = isActivePr(prValue) ? prValue : null;

          next[ws.id] = {
            staged,
            unstaged,
            untracked,
            ahead,
            behind,
            error:
              statusRes.status === 'fulfilled'
                ? statusRes.value?.error
                : statusRes.reason?.message || String(statusRes.reason || ''),
            pr,
          };
        } catch (error: any) {
          next[ws.id] = {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            ahead: 0,
            behind: 0,
            error: error?.message || String(error),
          };
        }
      }

      if (!cancelled) {
        setDeleteStatus(next);
        setDeleteStatusLoading(false);
      }
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [showDeleteDialog, selectedTasks]);

  useEffect(() => {
    let cancelled = false;

    const loadBranches = async () => {
      if (!project.path) return;
      setIsLoadingBranches(true);
      setBranchLoadError(null);
      try {
        const res = await window.electronAPI.listRemoteBranches({ projectPath: project.path });
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to load remote branches');
        }

        const options =
          res.branches?.map((item) => ({
            value: item.label,
            label: item.label,
          })) ?? [];

        const current = baseBranch ?? normalizeBaseRef(project.gitInfo.baseRef);
        const withCurrent =
          current && !options.some((opt) => opt.value === current)
            ? [{ value: current, label: current }, ...options]
            : options;

        if (!cancelled) {
          setBranchOptions(withCurrent);
        }
      } catch (error) {
        if (!cancelled) {
          setBranchLoadError(error instanceof Error ? error.message : String(error));
          setBranchOptions((prev) => {
            if (prev.length > 0) return prev;
            return baseBranch ? [{ value: baseBranch, label: baseBranch }] : [];
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false);
        }
      }
    };

    loadBranches();
    return () => {
      cancelled = true;
    };
  }, [project.id, project.path, project.gitInfo.baseRef, baseBranch, branchReloadToken]);

  const handleBaseBranchChange = useCallback(
    async (nextValue: string) => {
      const trimmed = normalizeBaseRef(nextValue);
      if (!trimmed || trimmed === baseBranch) return;
      const previous = baseBranch;
      setBaseBranch(trimmed);
      setIsSavingBaseBranch(true);
      try {
        const res = await window.electronAPI.updateProjectSettings({
          projectId: project.id,
          baseRef: trimmed,
        });
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to update base branch');
        }
        if (project.gitInfo) {
          project.gitInfo.baseRef = trimmed;
        }
        setBranchOptions((prev) => {
          if (prev.some((opt) => opt.value === trimmed)) return prev;
          return [{ value: trimmed, label: trimmed }, ...prev];
        });
        toast({
          title: 'Base branch updated',
          description: `New task runs will start from ${trimmed}.`,
        });
      } catch (error) {
        setBaseBranch(previous);
        toast({
          variant: 'destructive',
          title: 'Failed to update base branch',
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsSavingBaseBranch(false);
      }
    },
    [baseBranch, project.id, toast]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-6xl p-6">
          <div className="mx-auto w-full max-w-6xl space-y-4">
            <div className="space-y-4">
              <header className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
                    <div className="flex items-center gap-2 sm:self-start">
                      {onDeleteProject ? (
                        <ProjectDeleteButton
                          projectName={project.name}
                          tasks={project.tasks}
                          onConfirm={() => onDeleteProject?.(project)}
                          aria-label={`Delete project ${project.name}`}
                        />
                      ) : null}
                      {project.githubInfo?.connected && project.githubInfo.repository ? (
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.1, ease: 'easeInOut' }}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() =>
                            window.electronAPI.openExternal(
                              `https://github.com/${project.githubInfo?.repository}`
                            )
                          }
                        >
                          View on GitHub
                          <ArrowUpRight className="size-3" />
                        </motion.button>
                      ) : null}
                    </div>
                  </div>
                  <p className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
                    {project.path}
                  </p>
                </div>
                <BaseBranchControls
                  baseBranch={baseBranch}
                  branchOptions={branchOptions}
                  isLoadingBranches={isLoadingBranches}
                  isSavingBaseBranch={isSavingBaseBranch}
                  branchLoadError={branchLoadError}
                  onBaseBranchChange={handleBaseBranchChange}
                  onOpenChange={(isOpen) => {
                    if (isOpen) {
                      setBranchReloadToken((token) => token + 1);
                    }
                  }}
                  projectPath={project.path}
                />
              </header>
              <Separator className="my-2" />
            </div>

            {(() => {
              const directTasks = tasksInProject.filter((task) => task.useWorktree === false);
              if (directTasks.length === 0) return null;

              return (
                <Alert className="border-border bg-muted/50">
                  <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  <AlertTitle className="text-sm font-medium text-foreground">
                    Direct branch mode
                  </AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground">
                    {directTasks.length === 1 ? (
                      <>
                        <span className="font-medium text-foreground">{directTasks[0].name}</span>{' '}
                        is running directly on your current branch.
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">
                          {directTasks.map((t) => t.name).join(', ')}
                        </span>{' '}
                        are running directly on your current branch.
                      </>
                    )}{' '}
                    Changes will affect your working directory.
                  </AlertDescription>
                </Alert>
              );
            })()}

            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Tasks</h2>
                  <p className="text-xs text-muted-foreground">
                    Spin up a fresh, isolated task for this project.
                  </p>
                </div>
                {!isSelectMode && (
                  <div className="flex gap-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.1, ease: 'easeInOut' }}
                      className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                      onClick={onCreateTask}
                      disabled={isCreatingTask}
                      aria-busy={isCreatingTask}
                    >
                      {isCreatingTask ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Starting…
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 size-4" />
                          Start New Task
                        </>
                      )}
                    </motion.button>
                  </div>
                )}
              </div>
              {tasksInProject.length > 0 ? (
                <>
                  <div className="flex justify-end gap-2">
                    {isSelectMode && selectedCount > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 px-3 text-xs font-medium"
                        onClick={() => setShowDeleteDialog(true)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Deleting…
                          </>
                        ) : (
                          'Delete'
                        )}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => (isSelectMode ? exitSelectMode() : setIsSelectMode(true))}
                      className="h-8 px-3 text-xs font-medium"
                    >
                      {isSelectMode ? 'Cancel' : 'Select'}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {tasksInProject.map((ws) => (
                      <TaskRow
                        key={ws.id}
                        ws={ws}
                        isSelectMode={isSelectMode}
                        isSelected={selectedIds.has(ws.id)}
                        onToggleSelect={() => toggleSelect(ws.id)}
                        active={activeTask?.id === ws.id}
                        onClick={() => onSelectTask(ws)}
                        onDelete={() => onDeleteTask(project, ws)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <Alert>
                  <AlertTitle>What's a task?</AlertTitle>
                  <AlertDescription>
                    Each task is an isolated copy and branch of your repo (Git-tracked files only).
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected tasks and their worktrees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {deleteStatusLoading ? (
                <motion.div
                  key="bulk-delete-loading"
                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/30 px-4 py-4"
                >
                  <Spinner
                    className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground"
                    size="sm"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">Please wait...</span>
                    <span className="text-xs text-muted-foreground">
                      Scanning tasks for uncommitted changes and open pull requests
                    </span>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {(() => {
                const tasksWithUncommittedWorkOnly = selectedTasks.filter((ws) => {
                  const summary = deleteRisks.summaries[ws.id];
                  const status = deleteStatus[ws.id];
                  if (!summary && !status?.error) return false;
                  if (status?.pr && isActivePr(status.pr)) return false;
                  return true;
                });

                return tasksWithUncommittedWorkOnly.length > 0 && !deleteStatusLoading ? (
                  <motion.div
                    key="bulk-risk"
                    initial={{ opacity: 0, y: 6, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.99 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
                  >
                    <p className="font-medium">Unmerged or unpushed work detected</p>
                    <ul className="space-y-1">
                      {tasksWithUncommittedWorkOnly.map((ws) => {
                        const summary = deleteRisks.summaries[ws.id];
                        const status = deleteStatus[ws.id];
                        return (
                          <li
                            key={ws.id}
                            className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-50"
                          >
                            <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
                            <span className="font-medium">{ws.name}</span>
                            <span className="text-muted-foreground">—</span>
                            <span>{summary || status?.error || 'Status unavailable'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                ) : null;
              })()}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {(() => {
                const prTasks = selectedTasks
                  .map((ws) => ({ name: ws.name, pr: deleteStatus[ws.id]?.pr }))
                  .filter((w) => w.pr && isActivePr(w.pr));
                return prTasks.length && !deleteStatusLoading ? (
                  <motion.div
                    key="bulk-pr-notice"
                    initial={{ opacity: 0, y: 6, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.99 }}
                    transition={{ duration: 0.2, ease: 'easeOut', delay: 0.02 }}
                  >
                    <DeletePrNotice tasks={prTasks as any} />
                  </motion.div>
                ) : null;
              })()}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {deleteRisks.riskyIds.size > 0 && !deleteStatusLoading ? (
                <motion.label
                  key="bulk-ack"
                  className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: 'easeOut', delay: 0.03 }}
                >
                  <Checkbox
                    id="ack-delete"
                    checked={acknowledgeDirtyDelete}
                    onCheckedChange={(val) => setAcknowledgeDirtyDelete(val === true)}
                  />
                  <span className="leading-tight">Delete tasks anyway</span>
                </motion.label>
              ) : null}
            </AnimatePresence>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive px-4 text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={deleteDisabled}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectMainView;
