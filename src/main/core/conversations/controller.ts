import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { conversationSessionVisibilityService } from './conversation-session-visibility';
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
  updateVisibleConversations: (
    projectId: string,
    taskId: string,
    visibleConversationIds: string[]
  ) => {
    conversationSessionVisibilityService.updateVisibleConversations(
      projectId,
      taskId,
      visibleConversationIds
    );
    return ok();
  },
});
