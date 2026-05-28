import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { useConversations } from '@renderer/features/tasks/task-view-context';
import { ChatComposer } from './chat-composer';
import { ChatMessageList } from './chat-message-list';

interface ChatConversationPanelProps {
  conversation: ConversationStore;
}

export const ChatConversationPanel = observer(function ChatConversationPanel({
  conversation,
}: ChatConversationPanelProps) {
  const conversations = useConversations();
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ChatMessageList
        title={conversation.data.title || 'Chat conversation'}
        timeline={timeline}
        status={conversation.status}
      />
      <ChatComposer
        disabled={!timeline}
        working={isTurnBlocked}
        onSend={sendMessage}
        onCancel={cancelTurn}
      />
    </div>
  );
});
