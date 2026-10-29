import { toast } from '@emdash/ui/react/primitives';
import { useCallback, useRef } from 'react';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { InitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { log } from '@core/primitives/logging/browser/logger';
import type { NavigateFnTyped } from '@core/primitives/navigation/browser/navigation-hooks';
import { buildInitialConversation, deriveInitialStatus } from './build-create-task-params';
import { sendInitialImages } from './send-initial-images';
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
}: UseCreateTaskCallbackParams): { handleCreateTask: () => void; canCreate: boolean } {
  const submitting = useRef(false);
  const canCreate =
    !!selectedProjectId &&
    state.isValid &&
    initialConversation.settingsReady &&
    (initialConversation.imageAttachments.length === 0 ||
      (initialConversation.useChatUi && initialConversation.provider !== null));

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
    const conversation = buildInitialConversation(initialConversation);
    const images = [...initialConversation.imageAttachments];
    const initialMessage = initialConversation.prompt;
    void taskManager
      .createTask({
        id,
        projectId: selectedProjectId,
        taskConfig: {
          version: '1',
          name: state.taskName.effectiveTaskName,
          linkedIssue: state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
          initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
          initialConversation:
            images.length > 0 && conversation?.type === 'acp'
              ? { ...conversation, initialQueue: undefined }
              : conversation,
        },
        workspaceConfig: state.workspaceConfig.resolvedConfig,
      })
      .then(async () => {
        if (images.length > 0 && conversation?.type === 'acp') {
          try {
            await sendInitialImages(conversation, images, initialMessage);
          } catch (error) {
            log.error('Could not send initial images', error);
            toast.error('Could not send the initial image message', {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
      .catch((error) => log.error('create task failed', error));

    navigate(taskViewDef({ projectId: selectedProjectId, taskId: id }));
    onCreated();
  }, [selectedProjectId, state, initialConversation, navigate, onCreated, canCreate]);

  return { handleCreateTask: () => void handleCreateTask(), canCreate };
}
