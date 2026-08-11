import { log } from '@emdash/shared/logger';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import {
  legacyBaseProjectSettingsSchema,
  resolveEffectiveSettings,
  type EffectiveSettings,
  type RepoFacts,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import { migrateStoredBaseProjectSettings } from '../../../node/settings/stored-settings-migration';

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

/**
 * Stored git settings parsed straight from a project-settings DB row, for
 * flows that resolve before the project is mounted (e.g. automation deploys
 * at boot). Applies the lazy stored-model migration in memory only — no
 * write-back; the settings provider persists it on its next read.
 */
export function storedGitSettingsFromRow(
  baseProjectSettingsJson: string,
  repoFacts: RepoFacts | null
): StoredProjectGitSettings {
  const raw = legacyBaseProjectSettingsSchema.parse(JSON.parse(baseProjectSettingsJson));
  return migrateStoredBaseProjectSettings(raw, repoFacts).next;
}
