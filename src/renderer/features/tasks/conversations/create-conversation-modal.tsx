import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { getPaneContainer } from '@renderer/lib/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/lib/pty/pty-dimensions';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

function getConversationsPaneSize() {
  const container = getPaneContainer('conversations');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string }> & {
  projectId: string;
  taskId: string;
}) {
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPermissions = providerId ? autoApproveDefaults.getDefault(providerId) : false;
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
        autoApprove: skipPermissions,
        provider: providerId,
        title,
        initialSize: getConversationsPaneSize(),
      });
      onSuccess({ conversationId: id });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
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
          <Field>
            <div className="flex items-center gap-2">
              <Switch
                checked={skipPermissions}
                disabled={!providerId || autoApproveDefaults.loading || autoApproveDefaults.saving}
                onCheckedChange={(checked) => {
                  if (providerId) autoApproveDefaults.setDefault(providerId, checked);
                }}
              />
              <FieldLabel>Auto-approve permissions</FieldLabel>
            </div>
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
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
