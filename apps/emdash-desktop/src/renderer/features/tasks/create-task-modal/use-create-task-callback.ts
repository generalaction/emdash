import { useCallback } from 'react';
import { getTaskManagerStore, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { log } from '@renderer/utils/logger';
import {
  buildInitialConversationForTask,
  buildLoopTaskAuthoringInput,
  deriveInitialStatus,
} from './build-create-task-params';
import type { CreateTaskState } from './use-create-task-state';

interface UseCreateTaskCallbackParams {
  selectedProjectId: string | undefined;
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  navigate: NavigateFnTyped;
  onClose: () => void;
}

export function useCreateTaskCallback({
  selectedProjectId,
  state,
  initialConversation,
  navigate,
  onClose,
}: UseCreateTaskCallbackParams): { handleCreateTask: () => Promise<void>; canCreate: boolean } {
  const resolvedLoopModel =
    initialConversation.provider === 'codex'
      ? initialConversation.model?.trim() || undefined
      : undefined;
  const hasResolvedLoopModel = !state.loopPlan.enabled || Boolean(resolvedLoopModel);
  const canCreate = !!selectedProjectId && state.isValid && hasResolvedLoopModel;

  const handleCreateTask = useCallback(async () => {
    if (!selectedProjectId || !canCreate) return;
    const loopInput =
      state.loopPlan.enabled && resolvedLoopModel
        ? buildLoopTaskAuthoringInput(
            state.taskName.effectiveTaskName,
            state.loopPlan,
            resolvedLoopModel
          )
        : undefined;
    if (state.loopPlan.enabled && !loopInput) return;
    const taskManager = getTaskManagerStore(selectedProjectId);
    if (!taskManager) return;

    const id = crypto.randomUUID();
    const task = {
      id,
      projectId: selectedProjectId,
      taskConfig: {
        version: '1' as const,
        name: state.taskName.effectiveTaskName,
        linkedIssue: state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
        initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
        initialConversation: buildInitialConversationForTask(
          initialConversation,
          state.loopPlan.enabled
        ),
      },
      workspaceConfig: state.workspaceConfig.resolvedConfig,
    };

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
    try {
      if (loopInput) {
        const loop = await taskManager.createTaskWithLoop({
          task,
          loop: loopInput,
        });
        getTaskView(selectedProjectId, id)?.paneLayout.open(
          'loop',
          { loopId: loop.id },
          { preview: false }
        );
      } else {
        await taskManager.createTask(task);
      }
    } catch (error) {
      log.error(state.loopPlan.enabled ? 'create Loop task failed' : 'create task failed', error);
    }
  }, [
    selectedProjectId,
    state,
    initialConversation,
    navigate,
    onClose,
    canCreate,
    resolvedLoopModel,
  ]);

  return { handleCreateTask, canCreate };
}
