import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';
import { formatCommentsForAgent } from '../../shared/lineComments';
import { createRPCController } from '../../shared/ipc/rpc';

export const lineCommentsController = createRPCController({
  create: async (input: any) => {
    try {
      const id = await databaseService.saveLineComment(input);
      return { success: true, id };
    } catch (error) {
      log.error('Failed to create line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  get: async (args: { taskId: string; filePath?: string }) => {
    try {
      const comments = await databaseService.getLineComments(args.taskId, args.filePath);
      return { success: true, comments };
    } catch (error) {
      log.error('Failed to get line comments:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  update: async (input: { id: string; content: string }) => {
    try {
      await databaseService.updateLineComment(input.id, input.content);
      return { success: true };
    } catch (error) {
      log.error('Failed to update line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  delete: async (id: string) => {
    try {
      await databaseService.deleteLineComment(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  getFormatted: async (taskId: string) => {
    try {
      const comments = await databaseService.getLineComments(taskId);
      const formatted = formatCommentsForAgent(comments);
      return { success: true, formatted };
    } catch (error) {
      log.error('Failed to format line comments:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  markSent: async (commentIds: string[]) => {
    try {
      await databaseService.markCommentsSent(commentIds);
      return { success: true };
    } catch (error) {
      log.error('Failed to mark comments as sent:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  getUnsent: async (taskId: string) => {
    try {
      const comments = await databaseService.getUnsentComments(taskId);
      return { success: true, comments };
    } catch (error) {
      log.error('Failed to get unsent comments:', error);
      return { success: false, error: (error as Error).message };
    }
  },
});
