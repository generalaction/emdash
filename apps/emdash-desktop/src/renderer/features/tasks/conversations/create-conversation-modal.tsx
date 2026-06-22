import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { providerSupportsAutoApprove } from '@shared/core/agents/agent-auto-approve';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
  handoffSourceConversationId,
}: BaseModalProps<{ conversationId: string }> & {
  projectId: string;
  taskId: string;
  handoffSourceConversationId?: string;
}) {
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const taskSettings = useTaskSettings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoApproveOverride, setAutoApproveOverride] = useState<boolean | null>(null);
  useCloseGuard(isSubmitting);

  const isHandoff = handoffSourceConversationId !== undefined;
  const showAutoApproveToggle = providerId ? providerSupportsAutoApprove(providerId) : false;
  const skipPermissions =
    showAutoApproveToggle && (autoApproveOverride ?? taskSettings.autoApproveByDefault);
  const titleProviderId = providerId ?? 'claude';
  const title = nextDefaultConversationTitle(
    titleProviderId,
    Array.from(conversationMgr?.conversations.values() ?? [], (conversation) => conversation.data)
  );

  const handleCreateConversation = useCallback(async () => {
    if (createDisabled || isSubmitting || !conversationMgr || !providerId) return;
    const id = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);
    try {
      const handoff = handoffSourceConversationId
        ? await rpc.conversations.getConversationHandoffPrompt(
            projectId,
            taskId,
            handoffSourceConversationId,
            { delivery: connectionId ? 'inline' : 'document' }
          )
        : null;
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: skipPermissions,
        provider: providerId,
        title,
        initialPrompt: handoff?.prompt,
      });
      setIsSubmitting(false);
      if (handoff && !handoff.transcriptIncluded) {
        toast({
          title: 'Handoff started without transcript',
          description: 'The source session buffer was empty, so only session metadata was passed.',
        });
      }
      onSuccess({ conversationId: id });
    } catch {
      setError(isHandoff ? 'Failed to hand off conversation' : 'Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
    handoffSourceConversationId,
    isHandoff,
    isSubmitting,
    connectionId,
    providerId,
    title,
    onSuccess,
    projectId,
    taskId,
    skipPermissions,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isHandoff ? 'Hand off conversation' : 'Create Conversation'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          {isHandoff && (
            <p className="text-muted-foreground text-sm">
              Start a fresh conversation and pass over the latest source session context
              automatically.
            </p>
          )}
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector
              autoFocus
              value={providerId}
              onChange={setProviderOverride}
              connectionId={connectionId}
            />
          </Field>
          {showAutoApproveToggle ? (
            <Field>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skipPermissions}
                  disabled={!providerId || taskSettings.loading || taskSettings.saving}
                  onCheckedChange={setAutoApproveOverride}
                />
                <FieldLabel>Auto-approve permissions</FieldLabel>
              </div>
            </Field>
          ) : null}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          onClick={() => void handleCreateConversation()}
          disabled={createDisabled || isSubmitting}
        >
          {isSubmitting
            ? isHandoff
              ? 'Handing off...'
              : 'Creating...'
            : isHandoff
              ? 'Hand off'
              : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
