import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { GitBranch, Plus, Loader2, RefreshCw, Trash, ChevronDown } from 'lucide-react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from './ui/breadcrumb';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { usePullRequests, type PullRequestSummary } from '../hooks/usePullRequests';
import { useWorkspaceChanges } from '../hooks/useWorkspaceChanges';
import { ChangesBadge } from './WorkspaceChanges';
import { Spinner } from './ui/spinner';
import WorkspaceDeleteButton from './WorkspaceDeleteButton';
import AgentSelectionDialog from './AgentSelectionDialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import type { Provider } from '../types';

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

interface WorkspaceMetadata {
  linearIssue?: any;
  initialPrompt?: string | null;
  pullRequest?: {
    number: number;
    title: string;
    url?: string;
    author?: string | null;
    branch?: string;
  } | null;
}

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
  metadata?: WorkspaceMetadata | null;
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
  const [isRunning, setIsRunning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Don't fetch PR status for workspaces that were created from PRs
  const shouldFetchPrStatus = !ws.metadata?.pullRequest;
  const { pr } = usePrStatus(ws.path, shouldFetchPrStatus);
  const { totalAdditions, totalDeletions, isLoading } = useWorkspaceChanges(ws.path, ws.id);

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
        {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
          <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
        ) : pr && !ws.metadata?.pullRequest ? (
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
  onCheckoutPullRequest: (
    pr: PullRequestSummary,
    provider: Provider
  ) => Promise<{ success: boolean; error?: string }>;
}

const ProjectMainView: React.FC<ProjectMainViewProps> = ({
  project,
  onCreateWorkspace,
  activeWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
  isCreatingWorkspace = false,
  onCheckoutPullRequest,
}) => {
  const [isPrSectionOpen, setIsPrSectionOpen] = useState(false);
  const canLoadPrs = Boolean(project.githubInfo?.connected && project.gitInfo?.isGitRepo);
  const {
    prs,
    loading: prsLoading,
    error: prsError,
    refresh: refreshPrs,
  } = usePullRequests(
    canLoadPrs && isPrSectionOpen ? project.path : undefined,
    canLoadPrs && isPrSectionOpen
  );
  const [checkoutPrNumber, setCheckoutPrNumber] = useState<number | null>(null);
  const [selectedPr, setSelectedPr] = useState<PullRequestSummary | null>(null);
  const [showAgentDialog, setShowAgentDialog] = useState(false);

  const handleOpenAgentDialog = (pr: PullRequestSummary) => {
    setSelectedPr(pr);
    setShowAgentDialog(true);
  };

  const handleAgentSelected = async (provider: Provider) => {
    if (!selectedPr) return;

    setCheckoutPrNumber(selectedPr.number);
    setShowAgentDialog(false);

    try {
      const result = await onCheckoutPullRequest(selectedPr, provider);
      if (result.success) {
        // Success toast is handled by parent
      }
    } finally {
      setCheckoutPrNumber(null);
      setSelectedPr(null);
    }
  };

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
                <AlertTitle>What's a workspace?</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground">
                    Each workspace is an isolated copy and branch of your repo (Git-tracked files
                    only).
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {canLoadPrs && (
              <Collapsible open={isPrSectionOpen} onOpenChange={setIsPrSectionOpen}>
                <div className="space-y-3">
                  <div className="flex items-center justify-start gap-3">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="p-0 hover:bg-transparent">
                        <h2 className="flex items-center gap-2 text-lg font-semibold">
                          Pull Requests
                          <ChevronDown
                            className={`size-4 transition-transform ${isPrSectionOpen ? 'rotate-180' : ''}`}
                          />
                        </h2>
                      </Button>
                    </CollapsibleTrigger>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => refreshPrs()}
                      disabled={prsLoading}
                    >
                      <RefreshCw
                        className={`mr-2 size-4 ${prsLoading ? 'animate-spin' : ''}`}
                      />
                      Refresh
                    </Button>
                  </div>

                  <CollapsibleContent className="space-y-3">

                {prsError && (
                  <Alert variant="destructive">
                    <AlertTitle>Failed to load pull requests</AlertTitle>
                    <AlertDescription>{prsError}</AlertDescription>
                  </Alert>
                )}

                {prsLoading && !prs.length && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading pull requests...
                  </div>
                )}

                {!prsLoading && !prsError && prs.length === 0 && (
                  <Alert>
                    <AlertTitle>No open pull requests</AlertTitle>
                    <AlertDescription>
                      There are no open pull requests for this repository.
                    </AlertDescription>
                  </Alert>
                )}

                {prs.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {prs.map((pr) => {
                      const isCheckingOut = checkoutPrNumber === pr.number;
                      return (
                        <div
                          key={pr.number}
                          className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-medium leading-tight">
                                #{pr.number}
                              </span>
                              <span className="text-base font-medium leading-tight tracking-tight">
                                {pr.title}
                              </span>
                              {pr.isDraft && (
                                <Badge variant="secondary" className="text-xs">
                                  draft
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <GitBranch className="size-3" />
                              <span className="font-mono">{pr.headRefName}</span>
                              <span>→</span>
                              <span className="font-mono">{pr.baseRefName}</span>
                              {pr.authorLogin && (
                                <>
                                  <span>•</span>
                                  <span>by {pr.authorLogin}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAgentDialog(pr)}
                              disabled={isCheckingOut}
                            >
                              {isCheckingOut ? (
                                <>
                                  <Loader2 className="mr-2 size-4 animate-spin" />
                                  Checking out...
                                </>
                              ) : (
                                'Open in Workspace'
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}

            <AgentSelectionDialog
              isOpen={showAgentDialog}
              onClose={() => {
                setShowAgentDialog(false);
                setSelectedPr(null);
              }}
              onSelect={handleAgentSelected}
              prNumber={selectedPr?.number ?? 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectMainView;
