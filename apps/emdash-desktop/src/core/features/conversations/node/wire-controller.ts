import { createController, type Controller } from '@emdash/wire/api';
import { conversationOperations } from '@main/core/conversations/controller';
import { conversationsContract } from '../api';
import { conversationWireEvents } from './event-host';

export function createConversationsWireController(): Controller {
  return createController(conversationsContract, {
    getConversations: () => conversationOperations.getConversations(),
    createConversation: (input) => conversationOperations.createConversation(input),
    deleteConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.deleteConversation(projectId, taskId, conversationId),
    hydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.hydrateConversation(projectId, taskId, conversationId),
    dehydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.dehydrateConversation(projectId, taskId, conversationId),
    renameConversation: ({ conversationId, name }) =>
      conversationOperations.renameConversation(conversationId, name),
    getConversationsForTask: ({ projectId, taskId }) =>
      conversationOperations.getConversationsForTask(projectId, taskId),
    getConversationsForProject: ({ projectId }) =>
      conversationOperations.getConversationsForProject(projectId),
    markConversationSeen: ({ conversationId }) =>
      conversationOperations.markConversationSeen(conversationId),
    events: conversationWireEvents,
  });
}
