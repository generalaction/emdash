import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import {
  InitialConversationField,
  useInitialConversationState,
} from './initial-conversation-section';
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

  const [sectionTab, setSectionTab] = useState<SectionTab>('conversation');
  const [useBYOI, setUseBYOI] = useState(false);

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

  const resolvedInitialPR = initialStrategy === 'from-pull-request' ? initialPR : undefined;
  const state = useCreateTaskState(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    resolvedInitialPR
  );

  const initialConversation = useInitialConversationState(selectedProjectId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const { navigate } = useNavigate();

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);
  useEffect(() => {
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selectedProjectId]);

  // If opened with 'from-issue' strategy, pre-select the issue tab.
  useEffect(() => {
    if (initialStrategy === 'from-issue') state.setLinkedType('issue');
    if (initialStrategy === 'from-pull-request') state.setLinkedType('pr');
    // only run once on mount
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const prUnavailable = state.linkedType === 'pr' && !repositoryUrl;
  const canCreate = !!selectedProjectId && state.isValid && !prUnavailable;

  const handleCreateTask = useCallback(() => {
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
          initialPrompt: initialConversation.prompt.trim() || undefined,
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

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <div className="flex w-full flex-col gap-5">
          {/* Task name */}
          <TaskNameField state={state.taskName} />
          <div className="flex w-full flex-col justify-between overflow-hidden rounded-lg border">
            <div className="flex w-full items-center justify-between gap-2 border-b px-2 py-1">
              <span className="shrink-0 text-sm text-foreground-muted">Based on</span>
              <ToggleGroup
                className="gap-1! border-none bg-transparent p-0!"
                value={[state.linkedType]}
                onValueChange={([v]) => {
                  if (v) state.setLinkedType(v as LinkedType);
                }}
              >
                <ToggleGroupItem
                  className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
                  value="issue"
                >
                  Issue
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
                  value="pr"
                >
                  Pull Request
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div>
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
                <>
                  {!repositoryUrl ? (
                    <p className="text-muted-foreground text-sm h-14 items-center justify-center flex text-foreground-passive">
                      Pull requests are available only for configured GitHub remotes.
                    </p>
                  ) : (
                    <PrComboboxField
                      value={state.linkedPR}
                      onValueChange={state.setLinkedPR}
                      projectId={selectedProjectId}
                      repositoryUrl={repositoryUrl}
                      disabled={!repositoryUrl}
                    />
                  )}
                </>
              )}
            </div>
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
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
