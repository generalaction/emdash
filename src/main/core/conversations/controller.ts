import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { getConversationsForTask } from './getConversationsForTask';
import { renameConversation } from './renameConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  renameConversation,
  getConversationsForTask,
});
