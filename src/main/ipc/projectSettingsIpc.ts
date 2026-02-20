import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { projectSettingsService } from '../services/ProjectSettingsService';
import { worktreeService } from '../services/WorktreeService';

type ProjectSettingsArgs = { projectId: string };
type UpdateProjectSettingsArgs = {
  projectId: string;
  baseRef?: string;
  worktreeBasePath?: string | null;
};

const resolveProjectId = (input: ProjectSettingsArgs | string | undefined): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input.projectId;
};

export function registerProjectSettingsIpc() {
  ipcMain.handle('projectSettings:get', async (_event, args: ProjectSettingsArgs | string) => {
    try {
      const projectId = resolveProjectId(args);
      if (!projectId) {
        throw new Error('projectId is required');
      }
      const settings = await projectSettingsService.getProjectSettings(projectId);
      if (!settings) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, settings };
    } catch (error) {
      log.error('Failed to get project settings', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'projectSettings:update',
    async (_event, args: UpdateProjectSettingsArgs | undefined) => {
      try {
        const projectId = args?.projectId;
        if (!projectId) {
          throw new Error('projectId is required');
        }
        const updates: { baseRef?: string; worktreeBasePath?: string | null } = {};

        if (args?.baseRef !== undefined) {
          if (typeof args.baseRef !== 'string') {
            throw new Error('baseRef must be a string');
          }
          const trimmed = args.baseRef.trim();
          if (!trimmed) {
            throw new Error('baseRef cannot be empty');
          }
          updates.baseRef = trimmed;
        }

        if (args?.worktreeBasePath !== undefined) {
          if (args.worktreeBasePath !== null && typeof args.worktreeBasePath !== 'string') {
            throw new Error('worktreeBasePath must be a string or null');
          }
          updates.worktreeBasePath = args.worktreeBasePath;
        }

        if (Object.keys(updates).length === 0) {
          throw new Error('At least one project setting must be provided');
        }

        const settings = await projectSettingsService.updateProjectSettings(projectId, updates);
        return { success: true, settings };
      } catch (error) {
        log.error('Failed to update project settings', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    'projectSettings:fetchBaseRef',
    async (
      _event,
      args:
        | {
            projectId: string;
            projectPath: string;
          }
        | undefined
    ) => {
      try {
        const projectId = args?.projectId;
        const projectPath = args?.projectPath;
        if (!projectId) {
          throw new Error('projectId is required');
        }
        if (!projectPath) {
          throw new Error('projectPath is required');
        }
        const info = await worktreeService.fetchLatestBaseRef(projectPath, projectId);
        return {
          success: true,
          baseRef: info.fullRef,
          remote: info.remote,
          branch: info.branch,
        };
      } catch (error) {
        log.error('Failed to fetch base branch', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
