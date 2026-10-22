import type { PullRequest } from '@emdash/plugins/pull-requests/schemas';
import { Dialog } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import {
  issueTerms,
  preferredIssueProvider,
} from '@core/features/integrations/api/browser/integration-display';
import { useConnectedIssueProviders } from '@core/features/integrations/api/browser/use-connected-issue-providers';
import {
  firstAvailableProjectId,
  getProjectStore,
  getProjectViewStore,
  projectData as selectProjectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { useProjectGitContext } from '@core/features/tasks/api/browser/create-task-modal/use-project-git-context';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { taskHostActionAvailability } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { ConversationField } from '@core/features/tasks/contributions/browser/task-config/conversation-field';
import { useInitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { TaskConfigPanel } from '@core/features/tasks/contributions/browser/task-config/task-config-panel';
import { TaskStateProvider } from '@core/features/tasks/contributions/browser/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@core/features/tasks/contributions/browser/task-config/workspace-settings-section';
import { useModalController } from '@core/manifests/browser/modal-api';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { createTaskModalDefaults, type CreateTaskStrategy } from './create-task-modal-defaults';
import { LinkedEntitySection } from './linked-entity-section';
import { TaskNameField } from './task-name-field';
import { useCreateTaskCallback } from './use-create-task-callback';
import { useCreateTaskState } from './use-create-task-state';

function useDefaultProjectId(propProjectId?: string): string | undefined {
  return useMemo(() => {
    if (propProjectId) return propProjectId;
    const nav = getNavigation();
    const params = nav.currentRef.params as { projectId?: string };
    const navProjectId =
      nav.currentViewId === 'task' || nav.currentViewId === 'project'
        ? params.projectId
        : undefined;
    return navProjectId ?? firstAvailableProjectId();
    // oxlint-disable-next-line react/exhaustive-deps
  }, []); // computed once on mount
}

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy: initialStrategy,
  initialPR,
  initialWorkspaceId,
}: {
  projectId?: string;
  strategy?: CreateTaskStrategy;
  initialPR?: PullRequest;
  initialWorkspaceId?: string;
}) {
  const { complete } = useModalController('taskModal');
  const selectedProjectId = useDefaultProjectId(projectId);

  const projectData = selectedProjectId
    ? selectProjectData(getProjectStore(selectedProjectId))
    : null;

  const { defaultBranch, isUnborn, hasRepository, currentBranch, repositoryWorkspaceId } =
    useProjectGitContext(selectedProjectId);

  const repositoryStore = selectedProjectId ? getGitRepositoryStore(selectedProjectId) : undefined;
  const pullRequestRepositoryUrl = repositoryStore?.pullRequestRepositoryUrl ?? undefined;
  const repositoryUrl = repositoryStore?.canonicalRepositoryUrl ?? pullRequestRepositoryUrl;

  const projectPath = projectData?.path;

  const repositoryProvider = repositoryStore?.providerRepository?.provider;
  const { connectedProviders, hasAnyIssueIntegration } = useConnectedIssueProviders({
    projectId: selectedProjectId,
    repositoryUrl,
    projectPath,
    repositoryProvider,
  });
  const issueProvider = preferredIssueProvider(
    selectedProjectId
      ? (getProjectViewStore(selectedProjectId)?.selectedIssueProvider ?? null)
      : null,
    connectedProviders,
    repositoryProvider
  );
  const hasPrSupport =
    !!pullRequestRepositoryUrl && !!repositoryStore?.providerRepository?.capabilities.pullRequests;

  const defaults = createTaskModalDefaults(initialStrategy, {
    hasIssues: hasAnyIssueIntegration,
    hasPullRequests: hasPrSupport,
  });

  const resolvedInitialPR = initialStrategy === 'from-pull-request' ? initialPR : undefined;
  const state = useCreateTaskState(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    hasRepository,
    currentBranch,
    repositoryWorkspaceId,
    resolvedInitialPR,
    defaults.linkedType,
    initialWorkspaceId
  );

  const { includeIssueContextByDefault } = useTaskSettings();
  const initialConversation = useInitialConversationState(selectedProjectId);
  const { navigate } = useNavigate();

  const { handleCreateTask, canCreate } = useCreateTaskCallback({
    selectedProjectId,
    state,
    initialConversation,
    navigate,
    onCreated: complete,
  });
  const createAvailability = selectedProjectId
    ? taskHostActionAvailability(selectedProjectId)
    : ({ kind: 'disabled' } as const);
  const createDisabledReason = !selectedProjectId
    ? 'Select a Project.'
    : createAvailability.kind === 'disabled'
      ? (projectAvailabilityUi.getLiveActionDisabledReason(selectedProjectId) ??
        projectAvailabilityUi.defaultLiveActionDisabledReason)
      : undefined;

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
            requestProvider={repositoryProvider}
            issueLabel={issueTerms(issueProvider ?? repositoryProvider).title}
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
            requestProvider={repositoryProvider}
            linkedIssue={
              state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined
            }
            includeIssueContextByDefault={includeIssueContextByDefault}
          >
            <TaskConfigPanel
              defaultTab={defaults.tab}
              tabs={[
                {
                  value: 'conversation',
                  label: 'Initial Conversation',
                  content: <ConversationField />,
                },
                {
                  value: 'workspace',
                  label: 'Workspace Settings',
                  content: (
                    <WorkspaceSettingsSection
                      defaultOpen={defaults.tab === 'workspace' || !!initialWorkspaceId}
                    />
                  ),
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
          disabled={
            !canCreate || initialConversation.issueContextEditorOpen || !!createDisabledReason
          }
          title={createDisabledReason}
          aria-label={createDisabledReason ? `Create. ${createDisabledReason}` : 'Create'}
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
