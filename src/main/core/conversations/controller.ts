import { createRPCController } from '@shared/lib/ipc/rpc';
import { createConversation } from './createConversation';
import { dehydrateConversation } from './dehydrateConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { getConversationsForProject } from './getConversationsForProject';
import { getConversationsForTask } from './getConversationsForTask';
import { hydrateConversation } from './hydrateConversation';
import { markConversationSeen } from './markConversationSeen';
import { renameConversation } from './renameConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  hydrateConversation,
  dehydrateConversation,
  renameConversation,
  getConversationsForTask,
  getConversationsForProject,
  markConversationSeen,
});
