import { and, eq, lt } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { editorBuffers } from '@core/services/app-db/node/schema';

const BUFFER_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type EditorBufferServiceDeps = {
  db: AppDb;
  logger?: {
    error(message: string, error: unknown): void;
  };
};

export class EditorBufferService {
  constructor(private readonly deps: EditorBufferServiceDeps) {}

  async saveBuffer(
    projectId: string,
    workspaceId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const id = `${projectId}:${workspaceId}:${filePath}`;
    await this.deps.db
      .insert(editorBuffers)
      .values({ id, projectId, workspaceId, filePath, content, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: editorBuffers.id,
        set: { content, updatedAt: Date.now() },
      });
  }

  async clearBuffer(projectId: string, workspaceId: string, filePath: string): Promise<void> {
    const id = `${projectId}:${workspaceId}:${filePath}`;
    await this.deps.db.delete(editorBuffers).where(eq(editorBuffers.id, id));
  }

  async clearAllForWorkspace(workspaceId: string): Promise<void> {
    await this.deps.db.delete(editorBuffers).where(eq(editorBuffers.workspaceId, workspaceId));
  }

  async listBuffers(
    projectId: string,
    workspaceId: string
  ): Promise<{ filePath: string; content: string }[]> {
    const rows = await this.deps.db
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
      await this.deps.db.delete(editorBuffers).where(lt(editorBuffers.updatedAt, cutoff));
    } catch (e) {
      this.deps.logger?.error('Failed to prune stale editor buffers:', e);
    }
  }
}

export function createEditorBufferService(deps: EditorBufferServiceDeps): EditorBufferService {
  return new EditorBufferService(deps);
}
