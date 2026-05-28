import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { createRPCController } from '@shared/ipc/rpc';
import type { WorktreeEntry } from '@shared/workspaces';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { projectManager } from './project-manager';
import { projectSettingsService } from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  inspectProjectPath,
  getProjects,
  deleteProject,
  getProjectSettingsPage: (projectId: string) =>
    projectSettingsService.getProjectSettingsPage(projectId),
  updateProjectSettings: (projectId, settings) =>
    projectSettingsService.updateProjectSettings(projectId, settings),
  shareProjectSettingsToConfig: (projectId, request) =>
    projectSettingsService.shareProjectSettingsToConfig(projectId, request),
  migrateProjectConfig: (projectId, request) =>
    projectSettingsService.migrateProjectConfig(projectId, request),
  updateProjectConnection,
  openProject,
  async listWorktrees(projectId: string): Promise<WorktreeEntry[]> {
    const project = projectManager.getProject(projectId);
    if (!project) return [];
    return project.worktreeService.listWorktrees();
  },

  async getWorkspaceTaskCounts(projectId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({ path: workspaces.path, taskCount: count(tasks.id) })
      .from(tasks)
      .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)))
      .groupBy(workspaces.path);
    return Object.fromEntries(
      rows.filter((r) => r.path != null).map((r) => [r.path!, r.taskCount])
    );
  },
});
