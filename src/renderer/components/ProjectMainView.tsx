import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { GitBranch, Plus, Loader2 } from 'lucide-react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from './ui/breadcrumb';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { useWorkspaceChanges } from '../hooks/useWorkspaceChanges';
import { ChangesBadge } from './WorkspaceChanges';
import { Spinner } from './ui/spinner';
import WorkspaceDeleteButton from './WorkspaceDeleteButton';
import ProjectDeleteButton from './ProjectDeleteButton';
import { useToast } from '../hooks/use-toast';
import dockerLogo from '../../assets/images/docker.png';
import {
  getContainerRunState,
  startContainerRun,
  subscribeToWorkspaceRunState,
  type ContainerRunState,
} from '@/lib/containerRuns';

interface Project {
  id: string;
  name: string;
  path: string;
  repoKey?: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  workspaces?: Workspace[];
}

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
}

function StatusBadge({ status }: { status: Workspace['status'] }) {
  return (
    <Badge variant="secondary" className="capitalize">
      {status}
    </Badge>
  );
}

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
  const containerActive = useMemo(() => {
    const status = containerState?.status;
    return status === 'building' || status === 'starting' || status === 'ready';
  }, [containerState?.status]);

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

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={[
        'group flex items-start justify-between gap-3 rounded-xl border border-border bg-background',
        'px-4 py-3 transition-all hover:bg-muted/40 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active ? 'ring-2 ring-primary' : '',
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
        {/* Container controls */}
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={handleStartContainer}
          disabled={isStartingContainer || containerActive}
        >
          {isStartingContainer ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Starting…
            </>
          ) : (
            <>
              <img src={dockerLogo} alt="Docker" className="mr-1 h-4 w-4" /> Start
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={handleStopContainer}
          disabled={isStoppingContainer || !containerActive}
        >
          {isStoppingContainer ? 'Stopping…' : 'Stop'}
        </Button>
        {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
          <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
        ) : pr ? (
          <span
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={`${pr.title || 'Pull Request'} (#${pr.number})`}
          >
            {pr.isDraft ? 'draft' : pr.state.toLowerCase()}
          </span>
        ) : null}
        {ws.agentId && <Badge variant="outline">agent</Badge>}

        <WorkspaceDeleteButton
          workspaceName={ws.name}
          onConfirm={async () => {
            try {
              setIsDeleting(true);
              await onDelete();
            } finally {
              // If deletion succeeds, this row will unmount; if it fails, revert spinner
              setIsDeleting(false);
            }
          }}
          isDeleting={isDeleting}
          aria-label={`Delete workspace ${ws.name}`}
          className="inline-flex items-center justify-center rounded p-2 text-muted-foreground hover:bg-transparent hover:text-destructive focus-visible:ring-0"
        />
      </div>
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
  // PR list functionality is temporarily disabled.

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-6xl space-y-8 p-6">
          <div className="mb-8 space-y-2">
            <header className="flex items-start justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>

                <Breadcrumb className="text-muted-foreground">
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink className="text-muted-foreground">
                        {project.path}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    {project.gitInfo.branch && (
                      <BreadcrumbItem>
                        <Badge variant="secondary" className="gap-1">
                          <GitBranch className="size-3" />
                          origin/{project.gitInfo.branch}
                        </Badge>
                      </BreadcrumbItem>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              {onDeleteProject ? (
                <ProjectDeleteButton
                  projectName={project.name}
                  onConfirm={() => onDeleteProject?.(project)}
                  className="inline-flex items-center justify-center rounded p-2 text-muted-foreground hover:text-destructive"
                />
              ) : null}
            </header>
            <Separator className="my-2" />
          </div>

          <div className="max-w-4xl space-y-6">
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

            {/* Pull Requests section temporarily removed */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectMainView;
