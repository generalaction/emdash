import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { projectSettingsService } from '../services/ProjectSettingsService';

type ProjectSettingsArgs = { projectId: string };
type UpdateProjectSettingsArgs = { projectId: string; baseRef: string };

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
        const baseRef = args?.baseRef;
        if (!projectId) {
          throw new Error('projectId is required');
        }
        if (typeof baseRef !== 'string') {
          throw new Error('baseRef is required');
        }
        const trimmed = baseRef.trim();
        if (!trimmed) {
          throw new Error('baseRef cannot be empty');
        }
        const settings = await projectSettingsService.updateProjectSettings(projectId, {
          baseRef: trimmed,
        });
        return { success: true, settings };
      } catch (error) {
        log.error('Failed to update project settings', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
