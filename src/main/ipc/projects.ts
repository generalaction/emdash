import { eq } from 'drizzle-orm';
import { createRPCController } from '../../shared/ipc/rpc';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { getProjects } from '../core/projects/getProjects';
import {
  type CreateLocalProjectParams,
  handleCreateLocalProject,
} from '../core/projects/handleCreateProject';
import { environmentProviderManager } from '../environment/provider-manager';
import { log } from '../lib/logger';

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
        environmentProviderManager.addProject(row).catch((e) => {
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
    await environmentProviderManager.removeProject(id);
    await db.delete(projects).where(eq(projects.id, id));
  },
});
