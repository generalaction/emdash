import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { FieldGroup } from '@renderer/lib/ui/field';
import type { ConversationType } from '@shared/core/conversations/conversations';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import {
  InitialConversationField,
  useInitialConversationState,
} from './initial-conversation-section';

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string; type: ConversationType }> & {
  projectId: string;
  taskId: string;
}) {
  const conversationMgr = conversationRegistry.get(taskId);
  const taskSettings = useTaskSettings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCloseGuard(isSubmitting);

  const state = useInitialConversationState(
    projectId,
    undefined,
    taskSettings.autoApproveByDefault
  );

  const titleProviderId = state.provider ?? 'claude';
  const title = nextDefaultConversationTitle(
    titleProviderId,
    Array.from(conversationMgr?.conversations.values() ?? [], (conversation) => conversation.data)
  );

  const handleCreateConversation = useCallback(async () => {
    if (state.createDisabled || isSubmitting || !conversationMgr || !state.provider) return;
    const id = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);
    try {
      const conversationType: ConversationType = state.useChatUi ? 'acp' : 'pty';
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: state.autoApprove,
        provider: state.provider,
        title,
        model: state.model ?? undefined,
        type: conversationType,
        initialPrompt: state.prompt.trim() || undefined,
      });
      setIsSubmitting(false);
      onSuccess({ conversationId: id, type: conversationType });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    isSubmitting,
    title,
    onSuccess,
    projectId,
    taskId,
    state.createDisabled,
    state.provider,
    state.useChatUi,
    state.autoApprove,
    state.model,
    state.prompt,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <InitialConversationField state={state} includeIssueContextByDefault={false} />
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          onClick={() => void handleCreateConversation()}
          disabled={state.createDisabled || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
