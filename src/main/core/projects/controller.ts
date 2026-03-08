import { eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { workspaceManager } from '@main/core/workspaces/workspace-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { getProjects } from './getProjects';
import { handleCreateLocalProject, type CreateLocalProjectParams } from './handleCreateProject';

export const projectController = createRPCController({
  createProject: async (params: CreateLocalProjectParams) => {
    const result = await handleCreateLocalProject(params);
    if (result.success) {
      // Fetch the full project row so the provider manager can inspect
      // environmentProvider, sshConnectionId, etc.
      const [row] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, result.data.id))
        .limit(1);
      if (row) {
        workspaceManager.addProject(row).catch((e) => {
          log.error('projectController.createProject: failed to add provider', {
            projectId: row.id,
            error: String(e),
          });
        });
      }
    }
    return result;
  },
  getProjects,
  deleteProject: async (id: string) => {
    await workspaceManager.removeProject(id);
    await db.delete(projects).where(eq(projects.id, id));
  },
});
