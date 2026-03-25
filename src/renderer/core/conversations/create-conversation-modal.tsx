import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { makePtySessionId } from '@shared/ptySessionId';
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
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { getTaskStore, provisionedTask } from '@renderer/views/tasks/task-view-state';

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
  const [providerId, setProviderId] = useState<AgentProviderId>('claude');
  const conversationMgr = provisionedTask(getTaskStore(projectId, taskId))?.conversations;

  const providerIdConversationsCount = useMemo(() => {
    if (!conversationMgr) return 0;
    return Array.from(conversationMgr.conversations.values()).filter(
      (c) => c.data.providerId === providerId
    ).length;
  }, [conversationMgr, conversationMgr?.conversations.size, providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = useMemo(() => {
    return `${providerId} (${providerIdConversationsCount + 1})`;
  }, [providerId, providerIdConversationsCount]);

  const handleCreateConversation = useCallback(() => {
    const id = crypto.randomUUID();
    const sessionId = makePtySessionId(projectId, taskId, id);
    void frontendPtyRegistry.register(sessionId);
    void conversationMgr?.createConversation({
      projectId,
      taskId,
      id,
      provider: providerId,
      title,
      initialSize: getConversationsPaneSize(),
    });
    onSuccess({ conversationId: id });
  }, [conversationMgr, providerId, title, onSuccess, projectId, taskId]);

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
});
