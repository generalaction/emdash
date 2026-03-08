import { eq } from 'drizzle-orm';
import { dialog } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { getMainWindow } from '@main/app/window';
import { workspaceManager } from '@main/core/workspaces/workspace-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { getProjects } from './getProjects';
import { handleCreateLocalProject, type CreateLocalProjectParams } from './handleCreateProject';

export const projectController = createRPCController({
  createLocalProject: async (params: CreateLocalProjectParams) => {
    const result = await handleCreateLocalProject(params);
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error.type);
  },
  openSelectLocalProjectPathDialog: async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: 'Select Local Project Path',
      properties: ['openDirectory'],
      message: 'Select a project directory to open',
    });
    if (result.canceled || result.filePaths.length === 0) {
      throw new Error('No project path selected');
    }
    return result.filePaths[0];
  },
  getProjects,
  deleteProject: async (id: string) => {
    await workspaceManager.removeProject(id);
    await db.delete(projects).where(eq(projects.id, id));
  },
});
