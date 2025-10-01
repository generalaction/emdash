import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { GitBranch, Plus, Loader2, Trash } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "./ui/breadcrumb";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { usePrStatus } from "../hooks/usePrStatus";
import { useWorkspaceChanges } from "../hooks/useWorkspaceChanges";
import { ChangesBadge } from "./WorkspaceChanges";
import { Spinner } from "./ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

interface Project {
  id: string;
  name: string;
  path: string;
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
  status: "active" | "idle" | "running";
  agentId?: string;
}

function StatusBadge({ status }: { status: Workspace["status"] }) {
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
  const [isRunning, setIsRunning] = useState(false);
  const { pr } = usePrStatus(ws.path);
  const { totalAdditions, totalDeletions, isLoading } = useWorkspaceChanges(ws.path, ws.id);

  useEffect(() => {
    (async () => {
      try {
        const status = await (window as any).electronAPI.codexGetAgentStatus(
          ws.id
        );
        if (status?.success && status.agent) {
          setIsRunning(status.agent.status === "running");
        }
      } catch {}
    })();

    const offOut = (window as any).electronAPI.onCodexStreamOutput(
      (data: any) => {
        if (data.workspaceId === ws.id) setIsRunning(true);
      }
    );
    const offComplete = (window as any).electronAPI.onCodexStreamComplete(
      (data: any) => {
        if (data.workspaceId === ws.id) setIsRunning(false);
      }
    );
    const offErr = (window as any).electronAPI.onCodexStreamError(
      (data: any) => {
        if (data.workspaceId === ws.id) setIsRunning(false);
      }
    );
    return () => {
      offOut?.();
      offComplete?.();
      offErr?.();
    };
  }, [ws.id]);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={[
        "group flex items-start justify-between gap-3 rounded-xl border border-border bg-background",
        "px-4 py-3 transition-all hover:bg-muted/40 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active ? "ring-2 ring-primary" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="text-base font-medium leading-tight tracking-tight">
          {ws.name}
        </div>
        <div className="mt-1 flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
          {isRunning || ws.status === "running" ? (
            <Spinner size="sm" className="size-3" />
          ) : null}
          <GitBranch className="size-3" />
          <span
            className="font-mono truncate max-w-[24rem]"
            title={`origin/${ws.branch}`}
          >
            origin/{ws.branch}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
          <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
        ) : pr ? (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border 
              ${pr.state === 'MERGED' ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
              ${pr.state === 'OPEN' && pr.isDraft ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
              ${pr.state === 'OPEN' && !pr.isDraft ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
              ${pr.state === 'CLOSED' ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
            `}
            title={`${pr.title || 'Pull Request'} (#${pr.number})`}
          >
            {pr.isDraft ? 'draft' : pr.state.toLowerCase()}
          </span>
        ) : null}
        {ws.agentId && <Badge variant="outline">agent</Badge>}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive hover:bg-transparent focus-visible:ring-0"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Delete workspace ${ws.name}`}
            >
              <Trash className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            onClick={(e) => e.stopPropagation()}
            className="space-y-4"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
              <AlertDialogDescription>
                {`This will remove the worktree for "${ws.name}" and delete its branch.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-2"
                onClick={async (e) => {
                  e.stopPropagation();
                  await Promise.resolve(onDelete());
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
}

const ProjectMainView: React.FC<ProjectMainViewProps> = ({
  project,
  onCreateWorkspace,
  activeWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
  isCreatingWorkspace = false,
}) => {
  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto max-w-6xl p-8 space-y-8">
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
                  Each workspace is an isolated copy and branch of your repo (Git-tracked files only).
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectMainView;
