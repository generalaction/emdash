import type { IntegrationAccountSummary } from '@core/primitives/integrations/api';
import {
  resolveIntegrationAccount,
  type IntegrationAccountResolution,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';

/**
 * The issue-tracker account a project's API calls run as, straight from the
 * blessed pure resolver (`resolveIntegrationAccount`). Mirror of
 * `project-github-account-resolver`, minus the repo-host arm — issue trackers
 * have no repository relationship. Consumers read the resolver's provenance:
 *
 * - a value with `set` provenance is an explicit pin; with `inferred`, the
 *   default/only-account inference;
 * - `null` with `set` provenance is the explicit "disabled for this project";
 * - `null` with `inferred` provenance means no connected account;
 * - `null` with `unresolvable` provenance is a dangling pin — fail closed,
 *   never another workspace's credential.
 */
export type ProjectIntegrationAccountResolver = (input: {
  projectId: string;
  integrationId: string;
}) => Promise<IntegrationAccountResolution>;

export function createProjectIntegrationAccountResolver(deps: {
  getProjectById(projectId: string): Promise<Project | undefined>;
  getStoredGitSettings(projectId: string): Promise<StoredProjectGitSettings>;
  listAccounts(integrationId: string): Promise<IntegrationAccountSummary[]>;
}): ProjectIntegrationAccountResolver {
  return async ({ projectId, integrationId }) => {
    const project = await deps.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }
    const [stored, accounts] = await Promise.all([
      deps.getStoredGitSettings(projectId),
      deps.listAccounts(integrationId),
    ]);
    return resolveIntegrationAccount(stored.issueTrackerAccounts?.[integrationId], accounts);
  };
}
