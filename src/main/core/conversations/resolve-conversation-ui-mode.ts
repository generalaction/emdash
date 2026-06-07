import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AppSettings } from '@shared/core/app-settings';
import { isNativeChatProvider, type ConversationUiMode } from '@shared/conversation-ui';

/**
 * Decide which surface a new conversation should use. Native chat is limited
 * to providers with an adapter, on local tasks, when the setting opts in;
 * everything else stays on the terminal. The mode is captured at creation
 * time so flipping the app setting never re-routes a conversation that
 * already has a live session.
 */
export function resolveConversationUiMode({
  providerId,
  conversationUi,
  isRemoteTask,
}: {
  providerId: AgentProviderId;
  conversationUi: AppSettings['conversationUi'];
  isRemoteTask: boolean;
}): ConversationUiMode {
  if (!isNativeChatProvider(providerId)) return 'terminal';
  if (isRemoteTask) return 'terminal';
  return conversationUi.mode === 'native-chat' ? 'native-chat' : 'terminal';
}
