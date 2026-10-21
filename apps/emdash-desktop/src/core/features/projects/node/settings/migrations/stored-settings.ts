import { isDeepEqual } from '@emdash/shared';
import {
  resolveEffectiveSettings,
  type RepoFacts,
  type StoredBaseProjectSettings,
  type StoredDefaultBranch,
} from '@core/primitives/project-settings/api';
import { compactUndefined } from '../project-settings-json';
import {
  legacyBaseProjectSettingsSchema,
  legacyLifecycleSettingsFromStored,
  withLegacyLifecycleSettings,
  type LegacyBaseProjectSettings,
} from './legacy-stored-project-settings';

export type StoredSettingsMigrationResult = {
  next: StoredBaseProjectSettings;
  changed: boolean;
};

/** Canonical tolerant-version reader shared by execution, settings pages and account usage. */
export function readStoredProjectSettings(
  json: string,
  repoFacts: RepoFacts | null = null
): StoredBaseProjectSettings {
  return migrateStoredBaseProjectSettings(
    legacyBaseProjectSettingsSchema.parse(JSON.parse(json)),
    repoFacts
  ).next;
}

/**
 * Normalizes a historical DB JSON row into the current stored model. Pure: callers
 * may persist `next` when `changed`, or use it as a tolerant lazy reader.
 */
export function migrateStoredBaseProjectSettings(
  raw: LegacyBaseProjectSettings,
  repoFacts: RepoFacts | null,
  options: { tmuxDefault?: boolean } = {}
): StoredSettingsMigrationResult {
  const {
    remote: legacyRemote,
    worktreeDirectory: legacyWorktreeDirectory,
    githubAccountId: legacyGithubAccountId,
    defaultBranch: rawDefaultBranch,
    worktreeRoot,
    githubAccount,
    autoRunSetupScriptOnTaskCreation: _legacyAutoRunSetup,
    autoRunRunScriptOnTaskCreation: _legacyAutoRunRun,
    ...rest
  } = raw;

  const next: StoredBaseProjectSettings = { ...rest };

  const migratedWorktreeRoot = worktreeRoot ?? legacyWorktreeDirectory;
  if (migratedWorktreeRoot !== undefined) next.worktreeRoot = migratedWorktreeRoot;

  if (next.baseRemote === undefined && legacyRemote !== undefined) next.baseRemote = legacyRemote;

  // Fold the GitHub pin into the provider-account map (spec: github-git-settings
  // §10 generalized): legacy top-level keys migrate under `integrationAccounts.github`;
  // an existing map entry wins over the legacy keys.
  const legacyGithubAccount =
    githubAccount ??
    (typeof legacyGithubAccountId === 'string'
      ? ({ kind: 'account', accountId: legacyGithubAccountId } as const)
      : undefined);
  if (legacyGithubAccount !== undefined && next.integrationAccounts?.github === undefined) {
    next.integrationAccounts = { ...(next.integrationAccounts ?? {}), github: legacyGithubAccount };
  }

  const migratedDefaultBranch = migrateDefaultBranch(rawDefaultBranch, next.baseRemote, repoFacts);
  if (migratedDefaultBranch !== undefined) next.defaultBranch = migratedDefaultBranch;

  if (repoFacts) demoteIfMatchesInference(next, repoFacts);
  if (options.tmuxDefault !== undefined && next.tmuxDefaultMigrated !== true) {
    if (next.tmux === options.tmuxDefault) delete next.tmux;
    next.tmuxDefaultMigrated = true;
  }

  return {
    next,
    changed: !isDeepEqual(compactUndefined({ ...raw }), compactUndefined({ ...next })),
  };
}

function migrateDefaultBranch(
  value: LegacyBaseProjectSettings['defaultBranch'],
  storedBaseRemote: string | undefined,
  repoFacts: RepoFacts | null
): StoredDefaultBranch | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object') {
    if ('branch' in value) return value;
    return { remote: storedBaseRemote ?? 'origin', branch: value.name };
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const knownRemote = repoFacts?.remotes.find((remote) =>
    trimmed.startsWith(`${remote.name}/`)
  )?.name;
  if (knownRemote) return { remote: knownRemote, branch: trimmed.slice(knownRemote.length + 1) };

  const slash = trimmed.indexOf('/');
  if (slash > 0) return { remote: trimmed.slice(0, slash), branch: trimmed.slice(slash + 1) };
  return { remote: null, branch: trimmed };
}

function demoteIfMatchesInference(next: StoredBaseProjectSettings, repoFacts: RepoFacts): void {
  if (next.baseRemote !== undefined) {
    const inferred = resolveEffectiveSettings(
      { project: {}, builtInWorktreeRoot: '' },
      repoFacts
    ).baseRemote;
    if (inferred.provenance.kind === 'inferred' && inferred.value === next.baseRemote) {
      delete next.baseRemote;
    }
  }

  if (next.defaultBranch !== undefined) {
    const inferred = resolveEffectiveSettings(
      { project: { baseRemote: next.baseRemote }, builtInWorktreeRoot: '' },
      repoFacts
    ).defaultBranch;
    if (
      inferred.provenance.kind === 'inferred' &&
      isDeepEqual(inferred.value, next.defaultBranch)
    ) {
      delete next.defaultBranch;
    }
  }
}

/** Keep pending lifecycle migration sources until their explicit finalizer succeeds. */
export function serializeStoredProjectSettings(
  stored: StoredBaseProjectSettings,
  previousJson: string
): string {
  const legacy = legacyBaseProjectSettingsSchema.parse(JSON.parse(previousJson));
  return JSON.stringify(
    compactUndefined(
      withLegacyLifecycleSettings(stored, legacyLifecycleSettingsFromStored(legacy, {}))
    )
  );
}
