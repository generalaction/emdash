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

  // Auto-expand when we transition to ready and have ports
  useEffect(() => {
    if (isReady && (containerState?.ports?.length ?? 0) > 0) {
      setExpanded(true);
    }
    if (!containerActive) {
      setExpanded(false);
    }
  }, [isReady, containerActive, containerState?.ports?.length]);

  useEffect(() => {
    (async () => {
      try {
        const status = await (window as any).electronAPI.codexGetAgentStatus(ws.id);
        if (status?.success && status.agent) {
          setIsRunning(status.agent.status === 'running');
        }
      } catch {}
    })();

    const offOut = (window as any).electronAPI.onCodexStreamOutput((data: any) => {
      if (data.workspaceId === ws.id) setIsRunning(true);
    });
    const offComplete = (window as any).electronAPI.onCodexStreamComplete((data: any) => {
      if (data.workspaceId === ws.id) setIsRunning(false);
    });
    const offErr = (window as any).electronAPI.onCodexStreamError((data: any) => {
      if (data.workspaceId === ws.id) setIsRunning(false);
    });
    return () => {
      offOut?.();
      offComplete?.();
      offErr?.();
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
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto max-w-6xl p-6">
            <div className="mx-auto w-full max-w-6xl space-y-8">
              <div className="space-y-4">
                <header className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-
  between">
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
                        Each workspace is an isolated copy and branch of your repo (Git-tracked files only).
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

