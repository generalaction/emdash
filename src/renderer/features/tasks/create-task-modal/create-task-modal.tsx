import { AlertTriangle, ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { Button } from '@renderer/lib/ui/button';
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
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import type { CreateTaskLimitDecision } from '@shared/tasks';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { FromPrContent } from './from-pr-content';
import { useInitialConversationState } from './initial-conversation-section';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

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
  const isCheckingLimitRef = useRef(false);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
  const [useBYOI, setUseBYOI] = useState(false);
  const [limitWarning, setLimitWarning] = useState<CreateTaskLimitDecision | null>(null);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const initialConversation = useInitialConversationState(selectedProjectId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => setLimitWarning(null), [selectedProjectId, selectedStrategy]);
  useEffect(() => {
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    // setProvider and setPrompt are stable useState setters
    // oxlint-disable-next-line react/exhaustive-deps
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
  const fromPrUnavailable = selectedStrategy === 'from-pull-request' && !repositoryUrl;

  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
  }[selectedStrategy];
  const canCreate = !!selectedProjectId && activeMode.isValid && !fromPrUnavailable;

  const createTask = useCallback(() => {
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
          title: nextDefaultConversationTitle(initialConversation.provider, []),
          initialPrompt: initialConversation.prompt.trim() || undefined,
          autoApprove: autoApproveDefaults.getDefault(initialConversation.provider),
        }
      : undefined;

    switch (selectedStrategy) {
      case 'from-branch': {
        if (!fromBranch.selectedBranch) return;
        const taskStrategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromBranch.createBranchAndWorktree,
          taskBranch: fromBranch.branchName,
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
          taskBranch: fromIssue.branchName,
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
    isUnborn,
    useBYOI,
    initialConversation,
    autoApproveDefaults,
    navigate,
    onClose,
  ]);

  const handleCreateTask = useCallback(async () => {
    if (!selectedProjectId || isCheckingLimitRef.current) return;

    isCheckingLimitRef.current = true;
    setIsCheckingLimit(true);
    try {
      const decision = await rpc.tasks.getCreateTaskLimitDecision(selectedProjectId);
      if (decision.kind === 'soft-exceeded') {
        setLimitWarning(decision);
        return;
      }
    } catch {
      // Limit checks are advisory; task creation should fail open if usage is unavailable.
    } finally {
      isCheckingLimitRef.current = false;
      setIsCheckingLimit(false);
    }

    createTask();
  }, [createTask, selectedProjectId]);

  const continueAfterLimitWarning = useCallback(() => {
    setLimitWarning(null);
    createTask();
  }, [createTask]);

  const openAccountSettings = useCallback(() => {
    navigate('settings', { tab: 'account' });
  }, [navigate]);

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <ProjectSelector
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          trigger={
            <ComboboxTrigger className="flex h-6 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm outline-none">
              <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
              <ComboboxValue placeholder="Select a project" />
            </ComboboxTrigger>
          }
        />
        <ChevronRight className="size-3.5 text-foreground-passive" />
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <div className="flex shrink-0 flex-col gap-4 px-6 pb-4">
        <ToggleGroup
          className="w-full"
          value={[selectedStrategy]}
          onValueChange={([value]) => {
            if (value) {
              setSelectedStrategy(value as CreateTaskStrategy);
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="from-branch">
            From Branch
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-issue">
            From Issue
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-pull-request">
            From Pull Request
          </ToggleGroupItem>
        </ToggleGroup>
        {isWorkspaceProviderEnabled && (
          <div className="flex items-center gap-2">
            <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
            <span className="text-muted-foreground text-sm">Run on own infrastructure</span>
          </div>
        )}
      </div>
      <DialogContentArea>
        <AnimatedHeight onAnimatingChange={setIsTransitioning}>
          {limitWarning?.kind === 'soft-exceeded' && (
            <div className="mb-4 flex gap-3 rounded-lg border border-border bg-background-1 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-medium text-foreground">Task limit reached</p>
                <p className="text-foreground-muted">
                  You have {limitWarning.current} active tasks, which is at or above the current
                  limit of {limitWarning.limit}. You can continue for now, but may need to adjust
                  your plan later.
                </p>
              </div>
            </div>
          )}
          {selectedStrategy === 'from-branch' && (
            <FromBranchContent
              state={fromBranch}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
            />
          )}
          {selectedStrategy === 'from-issue' && (
            <FromIssueContent
              state={fromIssue}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              repositoryUrl={repositoryUrl}
              projectPath={projectData?.path}
              disabled={isTransitioning}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
            />
          )}
          {selectedStrategy === 'from-pull-request' && (
            <div className="flex flex-col gap-3">
              {!repositoryUrl && (
                <p className="text-muted-foreground text-sm">
                  Pull requests are currently available only for configured GitHub remotes.
                </p>
              )}
              <FromPrContent
                state={fromPR}
                projectId={selectedProjectId}
                repositoryUrl={repositoryUrl}
                disabled={isTransitioning || fromPrUnavailable}
                initialConversation={initialConversation}
              />
            </div>
          )}
        </AnimatedHeight>
      </DialogContentArea>
      <DialogFooter>
        {limitWarning?.kind === 'soft-exceeded' ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setLimitWarning(null)}>
              Back
            </Button>
            <Button size="sm" variant="outline" onClick={openAccountSettings}>
              Account settings
            </Button>
            <ConfirmButton size="sm" onClick={continueAfterLimitWarning} disabled={!canCreate}>
              Continue anyway
            </ConfirmButton>
          </>
        ) : (
          <ConfirmButton
            size="sm"
            onClick={handleCreateTask}
            disabled={!canCreate || isCheckingLimit}
          >
            Create
          </ConfirmButton>
        )}
      </DialogFooter>
    </>
  );
});
