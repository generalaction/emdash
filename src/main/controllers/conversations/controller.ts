import { createRPCController } from '@shared/ipc/rpc';

export const conversationController = createRPCController({
  getConversation: async (taskId: string) => {},
  deleteConversation: async (id: string) => {},
  createConversation: async (taskId: string) => {},
  setActiveConversation: async (taskId: string) => {},
  reorderConversations: async () => {},
});
