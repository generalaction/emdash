import { createConversationModal } from '../browser/create-conversation-modal';

export { AcpConversationChat } from '../browser/acp/acp-chat-host';

export const conversationsBrowserContributions = {
  modalDefs: [createConversationModal],
} as const;
