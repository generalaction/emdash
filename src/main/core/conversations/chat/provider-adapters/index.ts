import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ChatProviderAdapter } from '../types';
import { codexChatAdapter } from './codex-chat-adapter';

const CHAT_PROVIDER_ADAPTERS: ReadonlyMap<AgentProviderId, ChatProviderAdapter> = new Map([
  [codexChatAdapter.providerId, codexChatAdapter],
]);

export function getChatProviderAdapter(providerId: AgentProviderId): ChatProviderAdapter {
  const adapter = CHAT_PROVIDER_ADAPTERS.get(providerId);
  if (!adapter) throw new Error(`No chat provider adapter registered for ${providerId}`);
  return adapter;
}
