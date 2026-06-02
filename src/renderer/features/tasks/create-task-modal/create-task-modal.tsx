import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnectedIssueProviders } from '@renderer/features/integrations/use-connected-issue-providers';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
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
import type { PullRequest } from '@shared/pull-requests';
import {
  buildGitSetup,
  buildInitialConversation,
  buildWorkspaceLocation,
} from './build-create-task-params';
import { useInitialConversationState } from './initial-conversation-section';
import { LinkedEntitySection } from './linked-entity-section';
import { SectionTabsPanel } from './section-tabs-panel';
import { TaskNameField } from './task-name-field';
import { type LinkedType, useCreateTaskState } from './use-create-task-state';

function useDefaultProjectId(propProjectId?: string): string | undefined {
  return useMemo(() => {
    if (propProjectId) return propProjectId;
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
    // oxlint-disable-next-line react/exhaustive-deps
  }, []); // computed once on mount
}

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
  const selectedProjectId = useDefaultProjectId(projectId);

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

  const projectPath = projectData?.path;

  const { hasAnyIssueIntegration } = useConnectedIssueProviders({ repositoryUrl, projectPath });
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
  const { includeIssueContextByDefault } = useTaskSettings();
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const { navigate } = useNavigate();

  useEffect(() => {
    setUseBYOI(false);
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    initialConversation.setIssueContext(null);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);

  const canCreate = !!selectedProjectId && state.isValid;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    const id = crypto.randomUUID();
    const { linkedType, linkedPR } = state;
    const taskManager = projectStore.mountedProject!.taskManager;

    const gitSetup = buildGitSetup(state, isUnborn);
    const workspaceLocation = buildWorkspaceLocation(projectData, useBYOI);
    const initialStatus =
      linkedType === 'pr' && linkedPR
        ? linkedPR.status === 'open' && !linkedPR.isDraft
          ? 'review'
          : undefined
        : undefined;

    void taskManager
      .createTask({
        id,
        projectId: selectedProjectId,
        name: state.taskName.effectiveTaskName,
        gitSetup,
        workspaceLocation,
        linkedIssue: linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
        initialStatus,
        initialConversation: buildInitialConversation(
          id,
          selectedProjectId,
          initialConversation,
          autoApproveDefaults.getDefault
        ),
      })
      .catch(() => {});

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [
    selectedProjectId,
    projectData,
    state,
    isUnborn,
    useBYOI,
    initialConversation,
    autoApproveDefaults.getDefault,
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
          <TaskNameField state={state.taskName} />
          <LinkedEntitySection
            state={state}
            hasAnyIssueIntegration={hasAnyIssueIntegration}
            hasPrSupport={hasPrSupport}
            projectId={selectedProjectId}
            repositoryUrl={repositoryUrl}
            projectPath={projectPath}
          />
          <SectionTabsPanel
            state={state}
            initialConversation={initialConversation}
            projectId={selectedProjectId}
            currentBranch={currentBranch}
            isUnborn={isUnborn}
            useBYOI={useBYOI}
            setUseBYOI={setUseBYOI}
            isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
            includeIssueContextByDefault={includeIssueContextByDefault}
          />
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
