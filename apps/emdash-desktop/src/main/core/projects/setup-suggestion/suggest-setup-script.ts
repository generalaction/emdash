import { log } from '@main/lib/logger';
import type { SetupScriptSuggestion } from '@shared/core/projects/setup-suggestion';
import { projectManager } from '../project-manager';
import { detectSetupSuggestion } from './detect-setup-suggestion';

/**
 * Suggest a setup (lifecycle) command for a project based on the tooling detected
 * in its repository root. Returns null when the project is unknown, already has a
 * `scripts.setup` configured, or no recognizable tooling is present.
 */
export async function suggestSetupScript(projectId: string): Promise<SetupScriptSuggestion | null> {
  const project = projectManager.getProject(projectId);
  if (!project) return null;

  // Don't nag if the user already configured a setup script.
  try {
    const settings = await project.settings.get();
    if (settings.scripts?.setup && settings.scripts.setup.trim().length > 0) {
      return null;
    }
  } catch (error) {
    log.warn('suggestSetupScript: failed to read project settings', { projectId, error });
    // Fall through — a suggestion is still useful even if settings are unreadable.
  }

  try {
    return await detectSetupSuggestion(project.fs);
  } catch (error) {
    log.warn('suggestSetupScript: detection failed', { projectId, error });
    return null;
  }
}
