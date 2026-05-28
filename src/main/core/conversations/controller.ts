import { createRPCController } from '@shared/ipc/rpc';
import { cancelTurn } from './cancelConversationTurn';
import { createConversation } from './createConversation';
import { dehydrateConversation } from './dehydrateConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { getConversationsForTask } from './getConversationsForTask';
import { getTimeline } from './getConversationTimeline';
import { hydrateConversation } from './hydrateConversation';
import { renameConversation } from './renameConversation';
import { respondToPermission } from './respondToConversationPermission';
import { sendMessage } from './sendConversationMessage';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  hydrateConversation,
  dehydrateConversation,
  renameConversation,
  getConversationsForTask,
  getTimeline,
  sendMessage,
  cancelTurn,
  respondToPermission,
});
