import { ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import { FromAutorunContent } from './from-autorun-content';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { FromPrContent } from './from-pr-content';
import { useInitialConversationState } from './initial-conversation-section';
import { runAutorunBatch } from './run-autorun-batch';
import { useFromAutorunMode } from './use-from-autorun-mode';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request' | 'autorun';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy = 'from-branch',
  initialPR,
  onClose,
}: BaseModalProps & {
  projectId?: string;
  strategy?: CreateTaskStrategy;
  initialPR?: PullRequest;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (projectId) return projectId;
    const nav = appState.navigation;
    const navProjectId =
      nav.currentViewId === 'task'
        ? (nav.viewParamsStore['task'] as { projectId?: string } | undefined)?.projectId
        : nav.currentViewId === 'project'
          ? (nav.viewParamsStore['project'] as { projectId?: string } | undefined)?.projectId
          : undefined;
    return (
      navProjectId ??
      Array.from(getProjectManagerStore().projects.values())
        .reverse()
        .find((p) => p.state === 'mounted')?.data?.id
    );
  });
  const [selectedStrategy, setSelectedStrategy] = useState<CreateTaskStrategy>(strategy);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [useBYOI, setUseBYOI] = useState(false);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;

  const initialConversation = useInitialConversationState(connectionId);

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => {
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    // setProvider and setPrompt are stable useState setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);

  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;
  const { navigate } = useNavigate();

  const repositoryUrl = selectedProjectId
    ? (getRepositoryStore(selectedProjectId)?.repositoryUrl ?? undefined)
    : undefined;

  const fromBranch = useFromBranchMode(selectedProjectId, defaultBranch, isUnborn, currentBranch);
  const fromIssue = useFromIssueMode(selectedProjectId, defaultBranch, isUnborn, currentBranch);
  const fromPR = useFromPullRequestMode(selectedProjectId, defaultBranch, isUnborn, initialPR);
  const fromAutorun = useFromAutorunMode(selectedProjectId, defaultBranch, isUnborn, currentBranch);
  const fromPrUnavailable = selectedStrategy === 'from-pull-request' && !repositoryUrl;

  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
    autorun: fromAutorun,
  }[selectedStrategy];
  const canCreate = !!selectedProjectId && activeMode.isValid && !fromPrUnavailable;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    const builtInitialConversation = initialConversation.provider
      ? {
          id: crypto.randomUUID(),
          projectId: selectedProjectId,
          taskId: id,
          provider: initialConversation.provider,
          title: activeMode.taskName,
          initialPrompt: initialConversation.prompt.trim() || undefined,
        }
      : undefined;

    switch (selectedStrategy) {
      case 'from-branch': {
        if (!fromBranch.selectedBranch) return;
        const taskStrategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromBranch.createBranchAndWorktree,
          taskBranch: fromBranch.taskName,
          pushBranch: fromBranch.pushBranch,
        });
        void projectStore.mountedProject!.taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromBranch.taskName,
          sourceBranch: fromBranch.selectedBranch,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
      case 'from-issue': {
        if (!fromIssue.selectedBranch) return;
        const taskStrategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromIssue.createBranchAndWorktree,
          taskBranch: fromIssue.taskName,
          pushBranch: fromIssue.pushBranch,
        });
        void projectStore.mountedProject!.taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromIssue.taskName,
          sourceBranch: fromIssue.selectedBranch,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          linkedIssue: fromIssue.linkedIssue ?? undefined,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
      case 'autorun': {
        if (!fromAutorun.selectedBranch || fromAutorun.selectedIssues.length === 0) return;
        const taskManager = projectStore.mountedProject!.taskManager;
        const provider = initialConversation.provider;
        const sourceBranch = fromAutorun.selectedBranch;
        const issues = fromAutorun.selectedIssues;
        const opts = {
          projectId: selectedProjectId,
          sourceBranch,
          provider,
          concurrency: fromAutorun.concurrency,
          autoCreatePr: fromAutorun.autoCreatePr,
          extraPromptPrefix: fromAutorun.extraPrompt,
        };
        void runAutorunBatch(taskManager, issues, opts);
        onClose();
        return;
      }
      case 'from-pull-request': {
        if (!fromPR.linkedPR) return;
        const reviewBranch = fromPR.linkedPR.headRefName;
        const taskStrategy = resolvePullRequestTaskStrategy({
          checkoutMode: fromPR.checkoutMode,
          prNumber: getPrNumber(fromPR.linkedPR) ?? 0,
          headBranch: reviewBranch,
          headRepositoryUrl: fromPR.linkedPR.headRepositoryUrl,
          isFork: isForkPr(fromPR.linkedPR),
          taskBranch: fromPR.taskName,
          pushBranch: fromPR.branchSelection.pushBranch,
        });
        void projectStore.mountedProject!.taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromPR.taskName,
          sourceBranch: { type: 'local', branch: reviewBranch },
          initialStatus:
            fromPR.linkedPR.status === 'open' && !fromPR.linkedPR.isDraft ? 'review' : undefined,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
    }

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [
    selectedProjectId,
    selectedStrategy,
    fromBranch,
    fromIssue,
    fromPR,
    fromAutorun,
    isUnborn,
    useBYOI,
    initialConversation,
    activeMode.taskName,
    navigate,
    onClose,
  ]);

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <ProjectSelector
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          trigger={
            <ComboboxTrigger className="h-6 flex items-center gap-2 border border-border rounded-md px-2.5 py-1 text-sm outline-none">
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <ComboboxValue placeholder="Select a project" />
            </ComboboxTrigger>
          }
        />
        <ChevronRight className="size-3.5 text-foreground-passive" />
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <div className="px-6 pb-2 pt-1">
        <ToggleGroup
          className="w-full"
          value={[selectedStrategy === 'autorun' ? 'from-issue' : selectedStrategy]}
          onValueChange={([value]) => {
            if (value) {
              setSelectedStrategy(value as CreateTaskStrategy);
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="from-branch">
            Branch
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-issue">
            Issue
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-pull-request">
            Pull Request
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <DialogContentArea className="gap-4">
        {isWorkspaceProviderEnabled && (
          <div className="flex items-center gap-2">
            <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
            <span className="text-sm text-muted-foreground">Use BYOI infrastructure</span>
          </div>
        )}
        <AnimatedHeight onAnimatingChange={setIsTransitioning}>
          {selectedStrategy === 'from-branch' && (
            <FromBranchContent
              state={fromBranch}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
              connectionId={connectionId}
            />
          )}
          {(selectedStrategy === 'from-issue' || selectedStrategy === 'autorun') && (
            <div className="flex flex-col gap-4">
              <ToggleGroup
                className="w-full"
                value={[selectedStrategy]}
                onValueChange={([value]) => {
                  if (value === 'from-issue' || value === 'autorun') {
                    setSelectedStrategy(value);
                  }
                }}
              >
                <ToggleGroupItem className="flex-1" value="from-issue">
                  Single issue
                </ToggleGroupItem>
                <ToggleGroupItem className="flex-1" value="autorun">
                  Autorun issues
                </ToggleGroupItem>
              </ToggleGroup>
              {selectedStrategy === 'from-issue' ? (
                <FromIssueContent
                  state={fromIssue}
                  projectId={selectedProjectId}
                  currentBranch={currentBranch}
                  repositoryUrl={repositoryUrl}
                  projectPath={projectData?.path}
                  disabled={isTransitioning}
                  isUnborn={isUnborn}
                  initialConversation={initialConversation}
                  connectionId={connectionId}
                />
              ) : (
                <FromAutorunContent
                  state={fromAutorun}
                  projectId={selectedProjectId}
                  currentBranch={currentBranch}
                  repositoryUrl={repositoryUrl}
                  projectPath={projectData?.path}
                  isUnborn={isUnborn}
                  initialConversation={initialConversation}
                  connectionId={connectionId}
                />
              )}
            </div>
          )}
          {selectedStrategy === 'from-pull-request' && (
            <div className="flex flex-col gap-3">
              {!repositoryUrl && (
                <p className="text-sm text-muted-foreground">
                  Pull requests are currently available only for configured GitHub remotes.
                </p>
              )}
              <FromPrContent
                state={fromPR}
                projectId={selectedProjectId}
                repositoryUrl={repositoryUrl}
                disabled={isTransitioning || fromPrUnavailable}
                initialConversation={initialConversation}
                connectionId={connectionId}
              />
            </div>
          )}
        </AnimatedHeight>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          {selectedStrategy === 'autorun'
            ? `Run ${fromAutorun.selectedIssues.length} task${fromAutorun.selectedIssues.length === 1 ? '' : 's'}`
            : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
