import { log } from '../lib/logger';
import { projectSettingsService } from '../_deprecated/services/ProjectSettingsService';
import { worktreeService } from '../_deprecated/services/WorktreeService';
import { createRPCController } from '../../shared/ipc/rpc';

type ProjectSettingsArgs = { projectId: string };
type UpdateProjectSettingsArgs = { projectId: string; baseRef: string };

const resolveProjectId = (input: ProjectSettingsArgs | string | undefined): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input.projectId;
};

export const projectSettingsController = createRPCController({
  get: async (args: ProjectSettingsArgs | string) => {
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
  },

  update: async (args: UpdateProjectSettingsArgs | undefined) => {
    const projectId = args?.projectId;
    const baseRef = args?.baseRef;
    if (!projectId) throw new Error('projectId is required');
    if (typeof baseRef !== 'string') throw new Error('baseRef is required');
    const trimmed = baseRef.trim();
    if (!trimmed) throw new Error('baseRef cannot be empty');
    const settings = await projectSettingsService.updateProjectSettings(projectId, {
      baseRef: trimmed,
    });
    return { settings };
  },

  fetchBaseRef: async (
    args:
      | {
          projectId: string;
          projectPath: string;
        }
      | undefined
  ) => {
    const projectId = args?.projectId;
    const projectPath = args?.projectPath;
    if (!projectId) throw new Error('projectId is required');
    if (!projectPath) throw new Error('projectPath is required');
    const info = await worktreeService.fetchLatestBaseRef(projectPath, projectId);
    return {
      baseRef: info.fullRef,
      remote: info.remote,
      branch: info.branch,
    };
  },
});
