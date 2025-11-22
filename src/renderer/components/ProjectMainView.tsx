import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { GitBranch, Plus, Loader2, ChevronDown, ArrowUpRight } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { useWorkspaceChanges } from '../hooks/useWorkspaceChanges';
import { ChangesBadge } from './WorkspaceChanges';
import { Spinner } from './ui/spinner';
import WorkspaceDeleteButton from './WorkspaceDeleteButton';
import ProjectDeleteButton from './ProjectDeleteButton';
import BaseBranchControls, { RemoteBranchOption } from './BaseBranchControls';
import { useToast } from '../hooks/use-toast';
import ContainerStatusBadge from './ContainerStatusBadge';
import WorkspacePorts from './WorkspacePorts';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import dockerLogo from '../../assets/images/docker.png';
import {
  getContainerRunState,
  startContainerRun,
  subscribeToWorkspaceRunState,
  type ContainerRunState,
} from '@/lib/containerRuns';
import { activityStore } from '../lib/activityStore';
import type { Project, Workspace } from '../types/app';

const normalizeBaseRef = (ref?: string | null): string | undefined => {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function WorkspaceRow({
  ws,
  active,
  onClick,
  onDelete,
}: {
  ws: Workspace;
  active: boolean;
  onClick: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { pr } = usePrStatus(ws.path);
  const { totalAdditions, totalDeletions, isLoading } = useWorkspaceChanges(ws.path, ws.id);
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
    const off = subscribeToWorkspaceRunState(ws.id, (state) => setContainerState(state));
    return () => {
      off?.();
    };
  }, [ws.id]);

  // On mount, try to hydrate state by inspecting existing compose stack
  useEffect(() => {
    (async () => {
      try {
        const mod = await import('@/lib/containerRuns');
        await mod.refreshWorkspaceRunState(ws.id);
      } catch {}
    })();
  }, [ws.id]);

  const handleStartContainer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsStartingContainer(true);
      const res = await startContainerRun({
        workspaceId: ws.id,
        workspacePath: ws.path,
        mode: 'container',
      });
      if (res?.ok !== true) {
        toast({
          title: 'Failed to start container',
          description: res?.error?.message || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
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

  return (
    <div
      className={[
        'overflow-hidden rounded-xl border border-border bg-background',
        active ? 'ring-2 ring-primary' : '',
      ].join(' ')}
    >
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        className={[
          'group flex items-start justify-between gap-3 rounded-t-xl',
          'px-4 py-3 transition-all hover:bg-muted/40 hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        ].join(' ')}
      >
        <div className="min-w-0">
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
                    aria-label="Connect disabled for multi-agent workspaces"
                  >
                    <img src={dockerLogo} alt="Docker" className="mr-1.5 h-3.5 w-3.5" />
                    Connect
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
                  Docker containerization is not available for multi-agent workspaces.
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
              workspacePath={ws.path}
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
            <span
              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={`${pr.title || 'Pull Request'} (#${pr.number})`}
            >
              {pr.isDraft
                ? 'draft'
                : String(pr.state).toLowerCase() === 'open'
                  ? 'PR open'
                  : String(pr.state).toLowerCase()}
            </span>
          ) : null}
          {/* Agent badge commented out per user request
          {ws.agentId && <Badge variant="outline">agent</Badge>}
          */}

          <WorkspaceDeleteButton
            workspaceName={ws.name}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            aria-label={`Delete workspace ${ws.name}`}
            className="inline-flex items-center justify-center rounded p-2 text-muted-foreground hover:bg-transparent hover:text-destructive focus-visible:ring-0"
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {containerActive && expanded ? (
          <WorkspacePorts
            key={`ports-${ws.id}`}
            workspaceId={ws.id}
            workspacePath={ws.path}
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
  onCreateWorkspace: () => void;
  activeWorkspace: Workspace | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (project: Project, workspace: Workspace) => void | Promise<void>;
  isCreatingWorkspace?: boolean;
  onDeleteProject?: (project: Project) => void | Promise<void>;
}

const ProjectMainView: React.FC<ProjectMainViewProps> = ({
  project,
  onCreateWorkspace,
  activeWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
  isCreatingWorkspace = false,
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

  useEffect(() => {
    setBaseBranch(normalizeBaseRef(project.gitInfo.baseRef));
  }, [project.id, project.gitInfo.baseRef]);

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
          <div className="mx-auto w-full max-w-6xl space-y-8">
            <div className="space-y-4">
              <header className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
                    <div className="flex items-center gap-2 sm:self-start">
                      {project.githubInfo?.connected && project.githubInfo.repository ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 px-3 text-xs font-medium"
                          onClick={() =>
                            window.electronAPI.openExternal(
                              `https://github.com/${project.githubInfo?.repository}`
                            )
                          }
                        >
                          View on GitHub
                          <ArrowUpRight className="size-3" />
                        </Button>
                      ) : null}
                      {onDeleteProject ? (
                        <ProjectDeleteButton
                          projectName={project.name}
                          onConfirm={() => onDeleteProject?.(project)}
                          aria-label={`Delete project ${project.name}`}
                        />
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
                />
              </header>
              <Separator className="my-2" />
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-start gap-3">
                  <h2 className="text-lg font-semibold">Workspaces</h2>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onCreateWorkspace}
                    disabled={isCreatingWorkspace}
                    aria-busy={isCreatingWorkspace}
                  >
                    {isCreatingWorkspace ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 size-4" />
                        Create workspace
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex flex-col gap-3">
                  {(project.workspaces ?? []).map((ws) => (
                    <WorkspaceRow
                      key={ws.id}
                      ws={ws}
                      active={activeWorkspace?.id === ws.id}
                      onClick={() => onSelectWorkspace(ws)}
                      onDelete={() => onDeleteWorkspace(project, ws)}
                    />
                  ))}
                </div>
              </div>

              {(!project.workspaces || project.workspaces.length === 0) && (
                <Alert>
                  <AlertTitle>What’s a workspace?</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-4">
                    <p className="text-sm text-muted-foreground">
                      Each workspace is an isolated copy and branch of your repo (Git-tracked files
                      only).
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectMainView;
