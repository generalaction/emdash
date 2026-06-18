import { MessageSquare, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import {
  ACP_CAPABLE_PROVIDER_IDS,
  type ConversationType,
} from '@shared/core/conversations/conversations';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

export type CreateConversationResult = {
  conversationId: string;
  type: ConversationType;
};

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<CreateConversationResult> & {
  projectId: string;
  taskId: string;
}) {
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationType, setConversationType] = useState<ConversationType>('pty');

  const supportsAcp = providerId ? ACP_CAPABLE_PROVIDER_IDS.has(providerId) : false;
  const effectiveType: ConversationType = supportsAcp ? conversationType : 'pty';

  const skipPermissions =
    effectiveType === 'acp'
      ? true // ACP auto-approves internally; skip the toggle for ACP mode
      : providerId
        ? autoApproveDefaults.getDefault(providerId)
        : false;

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
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: effectiveType === 'pty' ? skipPermissions : undefined,
        provider: providerId,
        title,
        type: effectiveType,
      });
      onSuccess({ conversationId: id, type: effectiveType });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
    effectiveType,
    isSubmitting,
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
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector
              autoFocus
              value={providerId}
              onChange={setProviderOverride}
              connectionId={connectionId}
            />
          </Field>
          {supportsAcp && (
            <Field>
              <FieldLabel>Mode</FieldLabel>
              <div className="flex gap-1 rounded-lg border border-border bg-background-1 p-0.5">
                <button
                  type="button"
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    effectiveType === 'pty'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                  onClick={() => setConversationType('pty')}
                >
                  <Terminal className="size-3.5" />
                  Terminal
                </button>
                <button
                  type="button"
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    effectiveType === 'acp'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                  onClick={() => setConversationType('acp')}
                >
                  <MessageSquare className="size-3.5" />
                  Chat
                </button>
              </div>
            </Field>
          )}
          {effectiveType === 'pty' && (
            <Field>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skipPermissions}
                  disabled={
                    !providerId || autoApproveDefaults.loading || autoApproveDefaults.saving
                  }
                  onCheckedChange={(checked) => {
                    if (providerId) autoApproveDefaults.setDefault(providerId, checked);
                  }}
                />
                <FieldLabel>Auto-approve permissions</FieldLabel>
              </div>
            </Field>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
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
