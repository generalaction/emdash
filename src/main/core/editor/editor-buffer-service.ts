import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/main/db/client';
import { editorBuffers } from '@/main/db/schema';

export class EditorBufferService {
  async saveBuffer(
    projectId: string,
    taskId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const id = `${projectId}:${taskId}:${filePath}`;
    await db
      .insert(editorBuffers)
      .values({ id, projectId, taskId, filePath, content, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: editorBuffers.id,
        set: { content, updatedAt: Date.now() },
      });
  }

  async clearBuffer(projectId: string, taskId: string, filePath: string): Promise<void> {
    const id = `${projectId}:${taskId}:${filePath}`;
    await db.delete(editorBuffers).where(eq(editorBuffers.id, id));
  }

  async clearAllForTask(taskId: string): Promise<void> {
    await db.delete(editorBuffers).where(eq(editorBuffers.taskId, taskId));
  }

  async listBuffers(
    projectId: string,
    taskId: string
  ): Promise<{ filePath: string; content: string }[]> {
    const rows = await db
      .select({ filePath: editorBuffers.filePath, content: editorBuffers.content })
      .from(editorBuffers)
      .where(and(eq(editorBuffers.projectId, projectId), eq(editorBuffers.taskId, taskId)));
    return rows;
  }

  async pruneStale(olderThanMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanMs;
    await db.delete(editorBuffers).where(lt(editorBuffers.updatedAt, cutoff));
  }
}

export const editorBufferService = new EditorBufferService();
