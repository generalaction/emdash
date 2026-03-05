import { databaseService } from '../services/DatabaseService';
import { formatCommentsForAgent } from '../../shared/lineComments';
import { createRPCController } from '../../shared/ipc/rpc';
import type { LineCommentInsert } from '../db/schema';

type LineCommentCreateInput = Omit<LineCommentInsert, 'id' | 'createdAt' | 'updatedAt'>;

export const lineCommentsController = createRPCController({
  create: async (input: LineCommentCreateInput) => {
    const id = await databaseService.saveLineComment(input);
    return { id };
  },

  get: async (args: { taskId: string; filePath?: string }) => {
    const comments = await databaseService.getLineComments(args.taskId, args.filePath);
    return { comments };
  },

  update: async (input: { id: string; content: string }) => {
    await databaseService.updateLineComment(input.id, input.content);
  },

  delete: async (id: string) => {
    await databaseService.deleteLineComment(id);
  },

  getFormatted: async (taskId: string) => {
    const comments = await databaseService.getLineComments(taskId);
    const formatted = formatCommentsForAgent(comments);
    return { formatted };
  },

  markSent: async (commentIds: string[]) => {
    await databaseService.markCommentsSent(commentIds);
  },

  getUnsent: async (taskId: string) => {
    const comments = await databaseService.getUnsentComments(taskId);
    return { comments };
  },
});
