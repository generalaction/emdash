import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { buildFinalPrompt } from '../create-task-modal/initial-conversation-text';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import {
  InitialConversationField,
  useInitialConversationState,
} from './initial-conversation-section';

export interface CreateConversationModalResult {
  conversationId: string;
  openBrowserTab: boolean;
}

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<CreateConversationModalResult> & {
  projectId: string;
  taskId: string;
}) {
  const conversationMgr = conversationRegistry.get(taskId);
  const task = getRegisteredTaskData(projectId, taskId);
  const { autoApproveByDefault, includeIssueContextByDefault } = useTaskSettings();
  const initialConversation = useInitialConversationState(
    projectId,
    undefined,
    autoApproveByDefault
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openBrowserTab, setOpenBrowserTab] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCloseGuard(isSubmitting);

  const providerId = initialConversation.provider;
  const createDisabled = initialConversation.createDisabled;
  const titleProviderId = providerId ?? 'claude';
  const title = nextDefaultConversationTitle(
    titleProviderId,
    Array.from(conversationMgr?.conversations.values() ?? [], (conversation) => conversation.data)
  );

  const handleCreateConversation = useCallback(async () => {
    if (createDisabled || isSubmitting || !conversationMgr || !providerId) return;
    const id = crypto.randomUUID();
    const initialPrompt = buildFinalPrompt(
      initialConversation.issueContext,
      initialConversation.prompt
    );
    setIsSubmitting(true);
    setError(null);
    try {
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: initialConversation.autoApprove,
        provider: providerId,
        title,
        model: initialConversation.model ?? undefined,
        initialPrompt,
      });
      setIsSubmitting(false);
      onSuccess({ conversationId: id, openBrowserTab });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
    initialConversation.issueContext,
    initialConversation.prompt,
    initialConversation.autoApprove,
    initialConversation.model,
    isSubmitting,
    openBrowserTab,
    providerId,
    title,
    onSuccess,
    projectId,
    taskId,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <div className="flex flex-col gap-3">
          <InitialConversationField
            state={initialConversation}
            linkedIssue={task?.linkedIssue}
            includeIssueContextByDefault={includeIssueContextByDefault}
          />
          <label className="flex w-fit items-center gap-2 text-sm text-foreground-muted">
            <Checkbox
              checked={openBrowserTab}
              onCheckedChange={(checked) => setOpenBrowserTab(checked === true)}
            />
            <span>Open browser tab</span>
          </label>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          onClick={() => void handleCreateConversation()}
          disabled={createDisabled || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
