import {
  resolveProjectEffectiveSettings,
  type ProjectEffectiveSettingsSource,
  type RepoFactsSource,
} from '@core/features/projects/api/node/settings/effective-settings';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { Resolved } from '@core/primitives/project-settings/api';

/**
 * The GitHub account a project's API calls run as, straight from the blessed
 * resolver (spec: github-git-settings §2, §7). There is no error vocabulary
 * here — consumers speak the resolver's provenance directly:
 *
 * - a value with `set` provenance is an explicit pin; with `inferred`, the
 *   host-matching inference;
 * - `null` with `set` provenance is the explicit "GitHub disabled" intent;
 * - `null` with `inferred` provenance means inference found nothing;
 * - `null` with `unresolvable` provenance is a dangling or host-mismatched
 *   pin — fail closed, never another identity.
 */
export type ProjectGitHubAccountResolution = Resolved<GitHubAccountSummary | null>;

export type ProjectGitHubAccountResolver = (
  projectId: string
) => Promise<ProjectGitHubAccountResolution>;

type ProjectGitHubAccountProject = {
  settings: ProjectEffectiveSettingsSource;
  repoFacts: RepoFactsSource;
};

type ProjectLookup = {
  getProject(projectId: string): ProjectGitHubAccountProject | undefined;
};

export function createProjectGitHubAccountResolver(deps: {
  projects: ProjectLookup;
  listAccounts(): Promise<GitHubAccountSummary[]>;
}): ProjectGitHubAccountResolver {
  return async (projectId) => {
    const project = deps.projects.getProject(projectId);
    if (!project) {
      // A caller-precondition violation, not a resolution outcome (spec §7):
      // unmounted projects surface as a plain invariant error at the Wire
      // boundary instead of an account state.
      throw new Error(`Project ${projectId} is not mounted.`);
    }
    const effective = await resolveProjectEffectiveSettings({
      settings: project.settings,
      repoFacts: project.repoFacts,
      accounts: await deps.listAccounts(),
      projectId,
    });
    return effective.githubAccount;
  };
}
