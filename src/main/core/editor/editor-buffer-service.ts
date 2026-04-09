import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/main/db/client';
import { editorBuffers } from '@/main/db/schema';

export class EditorBufferService {
  async saveBuffer(
    projectId: string,
    workspaceId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const id = `${projectId}:${workspaceId}:${filePath}`;
    await db
      .insert(editorBuffers)
      .values({ id, projectId, workspaceId, filePath, content, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: editorBuffers.id,
        set: { content, updatedAt: Date.now() },
      });
  }

  async clearBuffer(projectId: string, workspaceId: string, filePath: string): Promise<void> {
    const id = `${projectId}:${workspaceId}:${filePath}`;
    await db.delete(editorBuffers).where(eq(editorBuffers.id, id));
  }

  async clearAllForWorkspace(workspaceId: string): Promise<void> {
    await db.delete(editorBuffers).where(eq(editorBuffers.workspaceId, workspaceId));
  }

  async listBuffers(
    projectId: string,
    workspaceId: string
  ): Promise<{ filePath: string; content: string }[]> {
    const rows = await db
      .select({ filePath: editorBuffers.filePath, content: editorBuffers.content })
      .from(editorBuffers)
      .where(
        and(eq(editorBuffers.projectId, projectId), eq(editorBuffers.workspaceId, workspaceId))
      );
    return rows;
  }

  async pruneStale(olderThanMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanMs;
    await db.delete(editorBuffers).where(lt(editorBuffers.updatedAt, cutoff));
  }
}

export const editorBufferService = new EditorBufferService();
