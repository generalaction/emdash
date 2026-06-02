import { useCallback } from 'react';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { log } from '@renderer/utils/logger';
import type { LocalProject, SshProject } from '@shared/projects';
import {
  buildInitialConversation,
  buildWorkspaceConfig,
  deriveInitialStatus,
} from './build-create-task-params';
import type { InitialConversationState } from './initial-conversation-section';
import type { CreateTaskState } from './use-create-task-state';

interface UseCreateTaskCallbackParams {
  selectedProjectId: string | undefined;
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  isUnborn: boolean;
  projectData: LocalProject | SshProject | null;
  useBYOI: boolean;
  navigate: NavigateFnTyped;
  onClose: () => void;
}

export function useCreateTaskCallback({
  selectedProjectId,
  state,
  initialConversation,
  isUnborn,
  projectData,
  useBYOI,
  navigate,
  onClose,
}: UseCreateTaskCallbackParams): { handleCreateTask: () => void; canCreate: boolean } {
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const canCreate = !!selectedProjectId && state.isValid;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const taskManager = getTaskManagerStore(selectedProjectId);
    if (!taskManager) return;

    const id = crypto.randomUUID();
    void taskManager
      .createTask({
        id,
        projectId: selectedProjectId,
        name: state.taskName.effectiveTaskName,
        workspaceConfig: buildWorkspaceConfig(state, isUnborn, projectData, useBYOI),
        linkedIssue: state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
        initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
        initialConversation: buildInitialConversation(
          id,
          selectedProjectId,
          initialConversation,
          autoApproveDefaults.getDefault
        ),
      })
      .catch((e) => log.error('create task failed', e));

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [
    selectedProjectId,
    state,
    isUnborn,
    projectData,
    useBYOI,
    initialConversation,
    autoApproveDefaults.getDefault,
    navigate,
    onClose,
  ]);

  return { handleCreateTask, canCreate };
}
