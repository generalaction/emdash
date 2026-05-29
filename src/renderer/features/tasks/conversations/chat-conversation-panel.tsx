import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { useConversations } from '@renderer/features/tasks/task-view-context';
import type { ConversationPermissionResponse } from '@shared/conversation-timeline';
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
    const command = parseSlashCommand(text);
    if (command) {
      const commands = await conversations.listCommands(conversation.data.id);
      if (commands.some((candidate) => candidate.name === command.name)) {
        await conversations.executeCommand(conversation.data.id, command);
        return;
      }
    }
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
        onSend={sendMessage}
        onCancel={cancelTurn}
      />
    </div>
  );
});

function parseSlashCommand(text: string): { name: string; args?: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.length <= 1) return undefined;
  const body = trimmed.slice(1);
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  if (!name || name.includes('/')) return undefined;
  const args = separator === -1 ? undefined : body.slice(separator + 1).trim();
  return args ? { name, args } : { name };
}
