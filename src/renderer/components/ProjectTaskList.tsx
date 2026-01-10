import React, { useEffect, useState } from 'react';
import { GitBranch, ChevronDown, ArrowUpRight } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';
import { Spinner } from './ui/spinner';
import TaskDeleteButton from './TaskDeleteButton';
import { Checkbox } from './ui/checkbox';
import { useToast } from '../hooks/use-toast';
import ContainerStatusBadge from './ContainerStatusBadge';
import TaskPorts from './TaskPorts';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import dockerLogo from '../../assets/images/docker.png';
import {
  getContainerRunState,
  startContainerRun,
  subscribeToTaskRunState,
  type ContainerRunState,
} from '@/lib/containerRuns';
import { activityStore } from '../lib/activityStore';
import PrPreviewTooltip from './PrPreviewTooltip';
import type { Project, Task } from '../types/app';

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
          <div className="text-base font-medium leading-tight tracking-tight">{ws.name}</div>
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

interface ProjectTaskListProps {
  project: Project;
  activeTask: Task | null;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  isSelectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (taskId: string) => void;
}

const ProjectTaskList: React.FC<ProjectTaskListProps> = ({
  project,
  activeTask,
  onSelectTask,
  onDeleteTask,
  isSelectMode,
  selectedIds,
  onToggleSelect,
}) => {
  const tasksInProject = project.tasks ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {tasksInProject.length > 0 ? (
          <>
            <div className="flex flex-col gap-3">
              {tasksInProject.map((ws) => (
                <TaskRow
                  key={ws.id}
                  ws={ws}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(ws.id)}
                  onToggleSelect={() => onToggleSelect(ws.id)}
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
  );
};

export default ProjectTaskList;
