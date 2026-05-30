import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { createRPCController } from '@shared/ipc/rpc';
import type {
  AddRepoInstanceParams,
  RemoveRepoInstanceResult,
  RepoInstance,
} from '@shared/projects';
import type { WorktreeEntry } from '@shared/workspaces';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import {
  addRepoInstance,
  listRepoInstances,
  listWorktreesForInstance,
  removeRepoInstance,
} from './operations/repo-instances';
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

  async getWorktreeStatuses(projectId: string, paths: string[]): Promise<Record<string, boolean>> {
    const project = projectManager.getProject(projectId);
    if (!project) return {};
    const results = await Promise.all(
      paths.map(async (p) => {
        try {
          const { stdout } = await project.ctx.exec('git', ['-C', p, 'status', '--porcelain']);
          return [p, stdout.trim().length > 0] as const;
        } catch {
          return [p, false] as const;
        }
      })
    );
    return Object.fromEntries(results);
  },

  async removeWorktree(
    projectId: string,
    worktreePath: string
  ): Promise<{ success: boolean; error?: string }> {
    const project = projectManager.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    try {
      await project.worktreeService.removeWorktree(worktreePath);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  listRepoInstances(projectId: string): Promise<RepoInstance[]> {
    return listRepoInstances(projectId);
  },

  addRepoInstance(params: AddRepoInstanceParams): Promise<RepoInstance> {
    return addRepoInstance(params);
  },

  removeRepoInstance(projectId: string, instanceId: string): Promise<RemoveRepoInstanceResult> {
    return removeRepoInstance(projectId, instanceId);
  },

  listWorktreesForInstance(projectId: string, instanceId: string): Promise<WorktreeEntry[]> {
    return listWorktreesForInstance(projectId, instanceId);
  },
});
