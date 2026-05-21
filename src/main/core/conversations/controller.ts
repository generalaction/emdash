import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { getConversationsForTask } from './getConversationsForTask';
import { renameConversation } from './renameConversation';
import { startConversationSession, stopConversationSession } from './sessionLifecycle';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  renameConversation,
  getConversationsForTask,
  startConversationSession,
  stopConversationSession,
});
