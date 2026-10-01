import { useCallback, useRef } from 'react';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { InitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { log } from '@core/primitives/logging/browser/logger';
import type { NavigateFnTyped } from '@core/primitives/navigation/browser/navigation-hooks';
import { buildInitialConversation, deriveInitialStatus } from './build-create-task-params';
import type { CreateTaskState } from './use-create-task-state';

interface UseCreateTaskCallbackParams {
  selectedProjectId: string | undefined;
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  navigate: NavigateFnTyped;
  onCreated: () => void;
}

export function useCreateTaskCallback({
  selectedProjectId,
  state,
  initialConversation,
  navigate,
  onCreated,
}: UseCreateTaskCallbackParams): {
  handleCreateTask: () => void;
  canCreate: boolean;
  autoNameWithAgent: boolean;
} {
  const submitting = useRef(false);
  const { autoNameWithAgent: autoNameEnabled } = useTaskSettings();
  const autoNameWithAgent =
    autoNameEnabled &&
    !state.taskName.taskName.trim() &&
    !!state.taskName.placeholder &&
    !(state.linkedType === 'issue' && state.linkedIssue) &&
    !(state.linkedType === 'pr' && state.linkedPR);
  const canCreate = !!selectedProjectId && state.isValid && initialConversation.settingsReady;

  const handleCreateTask = useCallback(async () => {
    if (!selectedProjectId || !canCreate || submitting.current) return;
    const taskManager = getTaskManagerStore(selectedProjectId);
    if (!taskManager) return;

    submitting.current = true;
    try {
      await initialConversation.flushSettings();
    } catch (error) {
      submitting.current = false;
      log.error('Could not save conversation settings', error);
      return;
    }
    const id = crypto.randomUUID();
    void taskManager
      .createTask({
        id,
        projectId: selectedProjectId,
        taskConfig: {
          version: '1',
          name: state.taskName.effectiveTaskName,
          ...(autoNameWithAgent && { autoNameWithAgent: true }),
          linkedIssue: state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
          initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
          initialConversation: buildInitialConversation(initialConversation, autoNameWithAgent),
        },
        workspaceConfig: state.workspaceConfig.resolvedConfig,
      })
      .catch((e) => log.error('create task failed', e));

    navigate(taskViewDef({ projectId: selectedProjectId, taskId: id }));
    onCreated();
  }, [
    selectedProjectId,
    state,
    initialConversation,
    navigate,
    onCreated,
    canCreate,
    autoNameWithAgent,
  ]);

  return { handleCreateTask: () => void handleCreateTask(), canCreate, autoNameWithAgent };
}
