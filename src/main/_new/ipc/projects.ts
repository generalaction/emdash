import { eq } from 'drizzle-orm';
import { createRPCController } from '../../../shared/ipc/rpc';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { getProjects } from '../core/projects/getProjects';
import {
  type CreateLocalProjectParams,
  handleCreateLocalProject,
} from '../core/projects/handleCreateProject';

export const projectController = createRPCController({
  createProject: async (params: CreateLocalProjectParams) => {
    return handleCreateLocalProject(params);
  },

  getProjects,

  deleteProject: async (id: string) => {
    await db.delete(projects).where(eq(projects.id, id));
  },
});
