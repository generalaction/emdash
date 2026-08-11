import { getProjectsWireClient } from '@core/features/projects/api/browser/client';
import { getProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { log } from '@core/primitives/logging/browser/logger';

/**
 * Persists an identity-strip account selection as the project's explicit
 * GitHub account pin (spec: github-git-settings §9 — "remember for this
 * project"). Failures are logged, not surfaced: the per-action override the
 * caller already holds keeps the current action correct either way.
 */
export async function persistProjectGitHubAccount(
  projectId: string,
  accountId: string
): Promise<void> {
  const result = await (
    await getProjectsWireClient()
  ).patchProjectSettings({
    projectId,
    patch: { githubAccountId: accountId },
  });
  if (!result.success) {
    log.error('Failed to persist GitHub account selection', { projectId, error: result.error });
    return;
  }
  getProjectSettingsStore(projectId)?.pageData.invalidate();
}
