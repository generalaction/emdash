import { AlertTriangle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { ISSUE_PROVIDER_ORDER } from '@renderer/features/integrations/issue-provider-meta';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import type { CreateTaskLimitDecision } from '@shared/tasks';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import {
  InitialConversationField,
  useInitialConversationState,
} from './initial-conversation-section';
import { buildFinalPrompt } from './initial-conversation-text';
import { IssueComboboxField } from './issue-combobox-field';
import { PrComboboxField } from './pr-combobox-field';
import { TaskNameField } from './task-name-field';
import { type LinkedType, useCreateTaskState } from './use-create-task-state';
import { WorkspaceSettingsSection } from './workspace-settings-section';

type SectionTab = 'conversation' | 'workspace';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy: initialStrategy = 'from-branch',
  initialPR,
  onClose,
}: BaseModalProps & {
  projectId?: string;
  strategy?: 'from-branch' | 'from-issue' | 'from-pull-request';
  initialPR?: PullRequest;
}) {
  const [selectedProjectId, _setSelectedProjectId] = useState<string | undefined>(() => {
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
  const [sectionTab, setSectionTab] = useState<SectionTab>('conversation');
  const isCheckingLimitRef = useRef(false);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
  const [useBYOI, setUseBYOI] = useState(false);
  const [limitWarning, setLimitWarning] = useState<CreateTaskLimitDecision | null>(null);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;

  const repositoryUrl = selectedProjectId
    ? (getRepositoryStore(selectedProjectId)?.pullRequestRepositoryUrl ?? undefined)
    : undefined;

  const { connectionStatus } = useIntegrationsContext();

  const hasAnyIssueIntegration = useMemo(
    () =>
      ISSUE_PROVIDER_ORDER.some((p) => {
        const s = connectionStatus[p];
        if (!s?.connected) return false;
        if (s.capabilities.requiresRepositoryUrl && !repositoryUrl) return false;
        if (s.capabilities.requiresProjectPath && !projectData?.path) return false;
        return true;
      }),
    [connectionStatus, repositoryUrl, projectData?.path]
  );

  const hasPrSupport = !!repositoryUrl;

  const defaultLinkedType = useMemo((): LinkedType => {
    if (initialStrategy === 'from-pull-request') return 'pr';
    if (initialStrategy === 'from-issue') return 'issue';
    if (hasAnyIssueIntegration) return 'issue';
    if (hasPrSupport) return 'pr';
    return null;
    // oxlint-disable-next-line react/exhaustive-deps
  }, []); // computed once on mount

  const resolvedInitialPR = initialStrategy === 'from-pull-request' ? initialPR : undefined;
  const state = useCreateTaskState(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    resolvedInitialPR,
    defaultLinkedType
  );

  const initialConversation = useInitialConversationState(selectedProjectId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const { navigate } = useNavigate();

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => setLimitWarning(null), [selectedProjectId, state.linkedType]);
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);
  useEffect(() => {
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    initialConversation.setIssueContext(null);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selectedProjectId]);

  const canCreate = !!selectedProjectId && state.isValid;

  const createTask = useCallback(() => {
    if (!selectedProjectId) return;
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    const id = crypto.randomUUID();

    const conversationProvider = initialConversation.provider;
    const builtInitialConversation = conversationProvider
      ? {
          id: crypto.randomUUID(),
          projectId: selectedProjectId,
          taskId: id,
          provider: conversationProvider,
          title: nextDefaultConversationTitle(conversationProvider, []),
          initialPrompt: buildFinalPrompt(
            initialConversation.issueContext,
            initialConversation.prompt
          ),
          autoApprove: autoApproveDefaults.getDefault(conversationProvider),
        }
      : undefined;

    const { linkedType, linkedIssue, linkedPR, checkoutMode, branchSelection, branchNameState } =
      state;

    if (linkedType === 'pr' && linkedPR) {
      const reviewBranch = linkedPR.headRefName;
      const taskStrategy = resolvePullRequestTaskStrategy({
        checkoutMode,
        prNumber: getPrNumber(linkedPR) ?? 0,
        headBranch: reviewBranch,
        headRepositoryUrl: linkedPR.headRepositoryUrl,
        isFork: isForkPr(linkedPR),
        taskBranch: state.taskName.effectiveTaskName,
        pushBranch: branchSelection.pushBranch,
      });
      void projectStore.mountedProject!.taskManager.createTask({
        id,
        projectId: selectedProjectId,
        name: state.taskName.effectiveTaskName,
        sourceBranch: { type: 'local', branch: reviewBranch },
        initialStatus: linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined,
        strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
        workspaceProvider: useBYOI ? 'byoi' : undefined,
        initialConversation: builtInitialConversation,
      });
    } else {
      if (!branchSelection.selectedBranch) return;
      const taskStrategy = resolveBranchLikeTaskStrategy({
        isUnborn,
        createBranchAndWorktree: branchSelection.createBranchAndWorktree,
        taskBranch: branchNameState.branchName,
        pushBranch: branchSelection.pushBranch,
      });
      void projectStore.mountedProject!.taskManager.createTask({
        id,
        projectId: selectedProjectId,
        name: state.taskName.effectiveTaskName,
        sourceBranch: branchSelection.selectedBranch,
        strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
        linkedIssue: linkedType === 'issue' ? (linkedIssue ?? undefined) : undefined,
        workspaceProvider: useBYOI ? 'byoi' : undefined,
        initialConversation: builtInitialConversation,
      });
    }

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [
    selectedProjectId,
    state,
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
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <div className="flex w-full flex-col gap-5">
          {limitWarning?.kind === 'soft-exceeded' && (
            <div className="flex gap-3 rounded-lg border border-border bg-background-1 p-3">
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
          {/* Task name */}
          <TaskNameField state={state.taskName} />
          <div className="flex w-full flex-col justify-between overflow-hidden rounded-lg border">
            <div
              className={`flex w-full items-center justify-between gap-2 px-2 py-1 ${state.linkedType ? 'border-b' : ''}`}
            >
              <span className="shrink-0 text-sm text-foreground-muted">Based on</span>
              <ToggleGroup
                className="gap-1! border-none bg-transparent p-0!"
                value={state.linkedType ? [state.linkedType] : []}
                onValueChange={([v]) => {
                  state.setLinkedType((v as LinkedType) ?? null);
                }}
              >
                <ToggleGroupItem
                  className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
                  value="issue"
                  disabled={!hasAnyIssueIntegration}
                >
                  Issue
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
                  value="pr"
                  disabled={!hasPrSupport}
                >
                  Pull Request
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {state.linkedType === 'issue' && (
              <IssueComboboxField
                value={state.linkedIssue}
                onValueChange={state.setLinkedIssue}
                projectId={selectedProjectId}
                repositoryUrl={repositoryUrl}
                projectPath={projectData?.path}
              />
            )}
            {state.linkedType === 'pr' && (
              <PrComboboxField
                value={state.linkedPR}
                onValueChange={state.setLinkedPR}
                projectId={selectedProjectId}
                repositoryUrl={repositoryUrl}
              />
            )}
          </div>
          {/* Section tabs */}
          <div className="flex flex-col gap-2">
            <div className="flex w-full items-center justify-between gap-2">
              <ToggleGroup
                className="w-full shrink-0 gap-1 border-none bg-transparent"
                value={[sectionTab]}
                onValueChange={([v]) => {
                  if (v) setSectionTab(v as SectionTab);
                }}
              >
                <ToggleGroupItem
                  className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
                  value="conversation"
                >
                  Initial Conversation
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
                  value="workspace"
                >
                  Workspace Settings
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="">
              {sectionTab === 'conversation' && (
                <InitialConversationField
                  state={initialConversation}
                  linkedIssue={
                    state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined
                  }
                />
              )}
              {sectionTab === 'workspace' && (
                <WorkspaceSettingsSection
                  state={state}
                  projectId={selectedProjectId}
                  currentBranch={currentBranch}
                  isUnborn={isUnborn}
                  useBYOI={useBYOI}
                  setUseBYOI={setUseBYOI}
                  isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
                />
              )}
            </div>
          </div>
        </div>
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
