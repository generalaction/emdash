import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import {
  resolveEffectiveSettings,
  type EffectiveSettings,
  type RepoFacts,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';

/**
 * The per-project repo-facts cache surface (spec: github-git-settings §2):
 * `null` means the facts are unavailable right now (degrade/skip and retry
 * later), never "the repository has no remotes".
 */
export type RepoFactsSource = {
  get(): Promise<RepoFacts | null>;
  dispose(): Promise<void>;
};

export type ProjectEffectiveSettingsSource = {
  getStoredGitSettings(): Promise<StoredProjectGitSettings>;
  getDefaultWorktreeDirectory(): Promise<string>;
};

export type ResolveProjectEffectiveSettingsOptions = {
  settings: ProjectEffectiveSettingsSource;
  repoFacts: RepoFactsSource;
  /**
   * Connected GitHub accounts for the account chain. Callers that only read
   * remotes/branches may omit this; the resolved `githubAccount` is
   * meaningless then and must not be consumed.
   */
  accounts?: GitHubAccountSummary[];
  /** Included in degrade warnings. */
  projectId?: string;
};

/**
 * Node-side entry to the blessed resolver (spec: github-git-settings §2):
 * every execution flow resolves effective values through this seam — stored
 * choices from the one settings provider, live facts from the per-project
 * repo-facts cache, accounts from the provider-account registry. No fallback
 * literals or ad-hoc default-account lookups may exist outside of it.
 *
 * Broken settings degrade inside the resolver (stale remote/branch → inferred
 * fallback) and are logged here once, so every flow warns consistently.
 */
export async function resolveProjectEffectiveSettings(
  options: ResolveProjectEffectiveSettingsOptions
): Promise<EffectiveSettings> {
  const [stored, facts, builtInWorktreeRoot] = await Promise.all([
    options.settings.getStoredGitSettings(),
    options.repoFacts.get(),
    options.settings.getDefaultWorktreeDirectory(),
  ]);
  const effective = resolveEffectiveSettings(
    { project: stored, builtInWorktreeRoot },
    facts ?? { remotes: [], localBranches: [] },
    options.accounts ?? []
  );
  warnAboutBrokenSettings(effective, options.projectId);
  return effective;
}

function warnAboutBrokenSettings(effective: EffectiveSettings, projectId?: string): void {
  for (const field of ['baseRemote', 'pushRemote', 'defaultBranch'] as const) {
    const resolved = effective[field];
    if (resolved.provenance.kind !== 'broken-setting') continue;
    log.warn(`Stale ${field} setting no longer matches the repository; using inferred fallback`, {
      projectId,
      staleValue: resolved.provenance.staleValue,
      fallback: resolved.value,
    });
  }
}

export type EffectiveSettingsProject = {
  settings: ProjectEffectiveSettingsSource;
  repoFacts: RepoFactsSource;
};

export type ProjectEffectiveSettingsError = {
  type: 'project-not-found';
  projectId: string;
  message: string;
};

/**
 * Project-id-keyed access to the resolver for flows that start from a project
 * id (issue provider, PR registration, GitHub auth context).
 */
export class ProjectEffectiveSettingsResolver {
  constructor(
    private readonly deps: {
      projects: { getProject(projectId: string): EffectiveSettingsProject | undefined };
      listGitHubAccounts(): Promise<GitHubAccountSummary[]>;
    }
  ) {}

  async resolve(
    projectId: string
  ): Promise<Result<EffectiveSettings, ProjectEffectiveSettingsError>> {
    const project = this.deps.projects.getProject(projectId);
    if (!project) {
      return err({
        type: 'project-not-found',
        projectId,
        message: `Project ${projectId} is not mounted.`,
      });
    }
    return ok(
      await resolveProjectEffectiveSettings({
        settings: project.settings,
        repoFacts: project.repoFacts,
        accounts: await this.deps.listGitHubAccounts(),
        projectId,
      })
    );
  }
}
