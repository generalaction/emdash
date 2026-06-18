import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useConnectedIssueProviders } from '@renderer/features/integrations/use-connected-issue-providers';
import {
  getProjectManagerStore,
  getGitRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { ConversationField } from '@renderer/features/tasks/task-config/conversation-field';
import { TaskConfigPanel } from '@renderer/features/tasks/task-config/task-config-panel';
import { TaskStateProvider } from '@renderer/features/tasks/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@renderer/features/tasks/task-config/workspace-settings-section';
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
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { useInitialConversationState } from '../conversations/initial-conversation-section';
import { LinkedEntitySection } from './linked-entity-section';
import { TaskNameField } from './task-name-field';
import { useCreateTaskCallback } from './use-create-task-callback';
import { type LinkedType, useCreateTaskState } from './use-create-task-state';
import { useProjectGitContext } from './use-project-git-context';

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

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;

  const { defaultBranch, isUnborn, currentBranch, repositoryWorkspaceId } =
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
    currentBranch,
    repositoryWorkspaceId,
    resolvedInitialPR,
    defaultLinkedType
  );

  const initialConversation = useInitialConversationState(selectedProjectId);
  const { includeIssueContextByDefault } = useTaskSettings();
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const { navigate } = useNavigate();

  const { handleCreateTask, canCreate } = useCreateTaskCallback({
    selectedProjectId,
    state,
    initialConversation,
    navigate,
    onClose,
  });

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
          <TaskStateProvider
            workspaceConfig={state.workspaceConfig}
            initialConversation={initialConversation}
            projectId={selectedProjectId}
            isUnborn={isUnborn}
            hasPR={state.linkedType === 'pr' && state.linkedPR !== null}
            isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
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
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
