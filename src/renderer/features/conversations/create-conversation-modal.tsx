import { useCallback, useMemo, useState } from 'react';
import { ProviderId } from '@shared/agent-provider-registry';
import { AgentSelector } from '@renderer/components/agent-selector';
import { Button } from '@renderer/components/ui/button';
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useConversationsContext } from './conversation-data-provider';

export function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string }> & {
  projectId: string;
  taskId: string;
}) {
  const [providerId, setProviderId] = useState<ProviderId>('claude');
  const { createConversation, conversationsByTaskId } = useConversationsContext();

  const providerIdConversationsCount = useMemo(() => {
    return conversationsByTaskId[taskId]?.filter(
      (conversation) => conversation.providerId === providerId
    ).length;
  }, [conversationsByTaskId, taskId, providerId]);

  const title = useMemo(() => {
    return `${providerId} (${providerIdConversationsCount + 1})`;
  }, [providerId, providerIdConversationsCount]);

  const handleCreateConversation = useCallback(() => {
    const id = crypto.randomUUID();
    createConversation({
      projectId,
      taskId,
      id,
      provider: providerId,
      title,
    });
    onSuccess({ conversationId: id });
  }, [createConversation, providerId, title, onSuccess, projectId, taskId]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel>Agent</FieldLabel>
          <AgentSelector value={providerId} onChange={setProviderId} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button onClick={handleCreateConversation}>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}
