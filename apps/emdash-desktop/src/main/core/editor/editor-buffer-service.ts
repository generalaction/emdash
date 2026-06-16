import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/main/db/client';
import { editorBuffers } from '@/main/db/schema';
import { log } from '@main/lib/logger';

const BUFFER_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

  async pruneStale(): Promise<void> {
    try {
      const cutoff = Date.now() - BUFFER_STALE_MS;
      await db.delete(editorBuffers).where(lt(editorBuffers.updatedAt, cutoff));
    } catch (e) {
      log.error('Failed to prune stale editor buffers:', e);
    }
  }
}

export const editorBufferService = new EditorBufferService();
