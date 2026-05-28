import { observer } from 'mobx-react-lite';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { ChatConversationPanel } from './chat-conversation-panel';
import { getConversationPanelMode } from './conversation-panel-mode';
import { TerminalConversationPanel } from './terminal-conversation-panel';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { tabManager } = useTabGroupContext();
  const activeConversation = tabManager.activeConversation;

  if (activeConversation && getConversationPanelMode(activeConversation.data) === 'chat') {
    return <ChatConversationPanel conversation={activeConversation} />;
  }

  return <TerminalConversationPanel />;
});
