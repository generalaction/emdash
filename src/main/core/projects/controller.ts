import { eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { workspaceManager } from '@main/core/workspaces/workspace-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { createLocalProject, createSshProject } from './createProject';
import { getProjects } from './getProjects';

export const projectController = createRPCController({
  createLocalProject,
  createSshProject,
  getProjects,
  deleteProject: async (id: string) => {
    await workspaceManager.removeProject(id);
    await db.delete(projects).where(eq(projects.id, id));
  },
});
