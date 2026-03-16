import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { startSession } from './startSession';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  startSession,
});
