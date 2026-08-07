import { Dialog } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useConnectedIssueProviders } from '@core/features/integrations/api/browser/use-connected-issue-providers';
import {
  getProjectManagerStore,
  mountedProjectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { useProjectGitContext } from '@core/features/tasks/api/browser/create-task-modal/use-project-git-context';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { ConversationField } from '@core/features/tasks/api/browser/task-config/conversation-field';
import { useInitialConversationState } from '@core/features/tasks/api/browser/task-config/initial-conversation-section';
import { TaskConfigPanel } from '@core/features/tasks/api/browser/task-config/task-config-panel';
import { TaskStateProvider } from '@core/features/tasks/api/browser/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@core/features/tasks/api/browser/task-config/workspace-settings-section';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';
import { LinkedEntitySection } from './linked-entity-section';
import { TaskNameField } from './task-name-field';
import { useCreateTaskCallback } from './use-create-task-callback';
import { type LinkedType, useCreateTaskState } from './use-create-task-state';

function useDefaultProjectId(propProjectId?: string): string | undefined {
  return useMemo(() => {
    if (propProjectId) return propProjectId;
    const nav = appState.navigation;
    const params = nav.currentRef.params as { projectId?: string };
    const navProjectId =
      nav.currentViewId === 'task' || nav.currentViewId === 'project'
        ? params.projectId
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
}: {
  projectId?: string;
  strategy?: 'from-branch' | 'from-issue' | 'from-pull-request';
  initialPR?: PullRequest;
}) {
  const { complete } = useModalController('taskModal');
  const selectedProjectId = useDefaultProjectId(projectId);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;

  const { defaultBranch, isUnborn, hasRepository, currentBranch, repositoryWorkspaceId } =
    useProjectGitContext(selectedProjectId);

  const repositoryStore = selectedProjectId ? getGitRepositoryStore(selectedProjectId) : undefined;
  const pullRequestRepositoryUrl = repositoryStore?.pullRequestRepositoryUrl ?? undefined;
  const repositoryUrl = repositoryStore?.canonicalRepositoryUrl ?? pullRequestRepositoryUrl;

  const projectPath = projectData?.path;

  const { hasAnyIssueIntegration } = useConnectedIssueProviders({ repositoryUrl, projectPath });
  const hasPrSupport = !!pullRequestRepositoryUrl;

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
    hasRepository,
    currentBranch,
    repositoryWorkspaceId,
    resolvedInitialPR,
    defaultLinkedType
  );

  const { autoApproveByDefault, includeIssueContextByDefault } = useTaskSettings();
  const initialConversation = useInitialConversationState(
    selectedProjectId,
    undefined,
    autoApproveByDefault
  );
  const { navigate } = useNavigate();

  const { handleCreateTask, canCreate } = useCreateTaskCallback({
    selectedProjectId,
    state,
    initialConversation,
    navigate,
    onCreated: complete,
  });

  return (
    <>
      <Dialog.Header className="flex items-center gap-2">
        <Dialog.Title>Create Task</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
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
          <TaskStateProvider
            workspaceConfig={state.workspaceConfig}
            initialConversation={initialConversation}
            projectId={selectedProjectId}
            isUnborn={isUnborn}
            hasRepository={hasRepository}
            hasPR={state.linkedType === 'pr' && state.linkedPR !== null}
            linkedIssue={
              state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined
            }
            includeIssueContextByDefault={includeIssueContextByDefault}
          >
            <TaskConfigPanel
              tabs={[
                {
                  value: 'conversation',
                  label: 'Initial Conversation',
                  content: <ConversationField />,
                },
                {
                  value: 'workspace',
                  label: 'Workspace Settings',
                  content: <WorkspaceSettingsSection defaultOpen={false} />,
                },
              ]}
            />
          </TaskStateProvider>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <ConfirmButton
          variant="primary"
          size="sm"
          onClick={handleCreateTask}
          disabled={!canCreate || initialConversation.issueContextEditorOpen}
        >
          Create
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

export const taskModal = defineModal<void>()({
  id: 'taskModal',
  component: CreateTaskModal,
  ignoreOutsidePressAfterWindowBlur: true,
});
