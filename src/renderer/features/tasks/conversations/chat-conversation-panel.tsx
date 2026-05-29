import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { useConversations } from '@renderer/features/tasks/task-view-context';
import type { ConversationPermissionResponse } from '@shared/conversation-timeline';
import { ChatComposer } from './chat-composer';
import { ChatMessageList } from './chat-message-list';
import { nextDefaultConversationTitle } from './conversation-title-utils';

interface ChatConversationPanelProps {
  conversation: ConversationStore;
}

export const ChatConversationPanel = observer(function ChatConversationPanel({
  conversation,
}: ChatConversationPanelProps) {
  const conversations = useConversations();
  const { tabManager } = useTabGroupContext();
  const timeline = conversations.timelines.get(conversation.data.id);
  const isWorking = conversation.status === 'working';
  const isTurnBlocked = isWorking || conversation.status === 'awaiting-input';

  useEffect(() => {
    timeline?.start();
  }, [timeline]);

  const sendMessage = async (text: string) => {
    if (!timeline || isTurnBlocked) return;
    await conversations.sendMessage(conversation.data.id, text);
  };

  const cancelTurn = async () => {
    if (!timeline || !isTurnBlocked) return;
    await conversations.cancelTurn(conversation.data.id);
  };

  const respondToPermission = async (response: ConversationPermissionResponse) => {
    if (!timeline) return;
    await conversations.respondToPermission(conversation.data.id, response);
  };

  const startFreshConversation = async () => {
    const id = crypto.randomUUID();
    const title = nextDefaultConversationTitle(
      conversation.data.providerId,
      Array.from(conversations.conversations.values(), (entry) => entry.data)
    );
    await conversations.createConversation({
      id,
      projectId: conversation.data.projectId,
      taskId: conversation.data.taskId,
      provider: conversation.data.providerId,
      title,
      autoApprove: conversation.data.autoApprove,
    });
    tabManager.openConversation(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ChatMessageList
        title={conversation.data.title || 'Chat conversation'}
        timeline={timeline}
        status={conversation.status}
        permissionResponsesEnabled={conversation.status === 'awaiting-input'}
        onRespondToPermission={respondToPermission}
      />
      <ChatComposer
        disabled={!timeline}
        working={isTurnBlocked}
        clientCommands={[
          {
            name: 'clear',
            aliases: ['new'],
            description: 'Start a fresh conversation',
            argumentHint: '',
            execution: 'client',
          },
        ]}
        loadControls={() => conversations.getControls(conversation.data.id)}
        loadCommands={() => conversations.listCommands(conversation.data.id)}
        commandScopeKey={conversation.data.id}
        onClientCommand={startFreshConversation}
        onFeatureChange={(featureId, value) =>
          conversations.setFeature(conversation.data.id, featureId, value)
        }
        onModelChange={(modelId) => conversations.setModel(conversation.data.id, modelId)}
        onSend={sendMessage}
        onCancel={cancelTurn}
      />
    </div>
  );
});
