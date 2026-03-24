import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
});
