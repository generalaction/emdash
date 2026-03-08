import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createRPCController } from '../../shared/ipc/rpc';
import { formatCommentsForAgent } from '../../shared/lineComments';
import { db } from '../db/client';
import { lineComments, type LineCommentInsert } from '../db/schema';

type LineCommentCreateInput = Omit<LineCommentInsert, 'id' | 'createdAt' | 'updatedAt'>;

export const lineCommentsController = createRPCController({
  create: async (input: LineCommentCreateInput) => {
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(lineComments).values({
      id,
      taskId: input.taskId,
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      lineContent: input.lineContent ?? null,
      content: input.content,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });
    return { id };
  },

  get: async (args: { taskId: string; filePath?: string }) => {
    const comments = args.filePath
      ? await db
          .select()
          .from(lineComments)
          .where(
            sql`${lineComments.taskId} = ${args.taskId} AND ${lineComments.filePath} = ${args.filePath}`
          )
          .orderBy(asc(lineComments.lineNumber))
      : await db
          .select()
          .from(lineComments)
          .where(eq(lineComments.taskId, args.taskId))
          .orderBy(asc(lineComments.lineNumber));
    return { comments };
  },

  update: async (input: { id: string; content: string }) => {
    await db
      .update(lineComments)
      .set({ content: input.content, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(lineComments.id, input.id));
  },

  delete: async (id: string) => {
    await db.delete(lineComments).where(eq(lineComments.id, id));
  },

  getFormatted: async (taskId: string) => {
    const comments = await db
      .select()
      .from(lineComments)
      .where(eq(lineComments.taskId, taskId))
      .orderBy(asc(lineComments.lineNumber));
    const formatted = formatCommentsForAgent(comments);
    return { formatted };
  },

  markSent: async (commentIds: string[]) => {
    if (commentIds.length === 0) return;
    const now = new Date().toISOString();
    await db.update(lineComments).set({ sentAt: now }).where(inArray(lineComments.id, commentIds));
  },

  getUnsent: async (taskId: string) => {
    const comments = await db
      .select()
      .from(lineComments)
      .where(and(eq(lineComments.taskId, taskId), isNull(lineComments.sentAt)))
      .orderBy(asc(lineComments.filePath), asc(lineComments.lineNumber));
    return { comments };
  },
});
