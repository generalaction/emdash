import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveProjectTmuxEnabled, type ProjectSettings } from '@shared/project-settings';

export { resolveProjectTmuxEnabled };

export async function getProjectTmuxEnabled(projectSettings: ProjectSettings): Promise<boolean> {
  const { tmuxByDefault } = await appSettingsService.get('project');
  return resolveProjectTmuxEnabled(projectSettings, tmuxByDefault);
}
