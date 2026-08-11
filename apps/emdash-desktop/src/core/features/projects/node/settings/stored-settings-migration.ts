import { isDeepEqual } from '@emdash/shared';
import {
  formatDefaultBranch,
  resolveEffectiveSettings,
  type RepoFacts,
  type StoredDefaultBranch,
} from '@core/primitives/project-settings/api';
import type {
  BaseProjectSettings,
  LegacyBaseProjectSettings,
  StoredBaseProjectSettings,
} from '@core/primitives/project-settings/api';
import { compactUndefined } from './project-settings-json';

/**
 * Lazy read-path migrations for stored base project settings
 * (spec: github-git-settings §10). Pure: the provider parses the row with the
 * permissive legacy schema, runs this, and writes the result back when it
 * changed.
 *
 * 1. Legacy `defaultBranch` forms → structured `{ remote, branch }`.
 * 2. Legacy `githubAccountId` strings → `{ kind: 'account', accountId }`;
 *    legacy `null` → absent (infer), not explicit none.
 * 3. Demote-if-matches-inference for `baseRemote`/`defaultBranch` (requires
 *    repo facts; skipped and retried next read when facts are unavailable).
 * 4. `worktreeDirectory` key → `worktreeRoot`.
 *
 * (Migration 5 — the app-wide `defaultWorktreeDirectory` — lives in
 * app-worktree-root-migration.ts; it touches app settings and host settings,
 * not the row.)
 */
export type StoredSettingsMigrationResult = {
  next: StoredBaseProjectSettings;
  changed: boolean;
};

export function migrateStoredBaseProjectSettings(
  raw: LegacyBaseProjectSettings,
  repoFacts: RepoFacts | null
): StoredSettingsMigrationResult {
  const {
    remote: legacyRemote,
    worktreeDirectory: legacyWorktreeDirectory,
    githubAccountId: legacyGithubAccountId,
    defaultBranch: rawDefaultBranch,
    worktreeRoot,
    githubAccount,
    ...rest
  } = raw;

  const next: StoredBaseProjectSettings = { ...rest };

  // Migration 4: worktreeDirectory key → worktreeRoot (new key wins if both).
  const migratedWorktreeRoot = worktreeRoot ?? legacyWorktreeDirectory;
  if (migratedWorktreeRoot !== undefined) next.worktreeRoot = migratedWorktreeRoot;

  // Pre-baseRemote `remote` key (normally rewritten by the legacy .emdash.json
  // migration already, but tolerate rows where it survived).
  if (next.baseRemote === undefined && legacyRemote !== undefined) next.baseRemote = legacyRemote;

  // Migration 2: githubAccountId string → account ref; legacy null → absent
  // (today's null rows are overwhelmingly never-configured defaults).
  if (githubAccount !== undefined) {
    next.githubAccount = githubAccount;
  } else if (typeof legacyGithubAccountId === 'string') {
    next.githubAccount = { kind: 'account', accountId: legacyGithubAccountId };
  }

  // Migration 1: legacy defaultBranch forms → structured { remote, branch }.
  const migratedDefaultBranch = migrateDefaultBranch(rawDefaultBranch, next.baseRemote, repoFacts);
  if (migratedDefaultBranch !== undefined) next.defaultBranch = migratedDefaultBranch;

  // Migration 3: demote stored values equal to the current inference. Requires
  // repo facts; without them the values stay pinned and we retry next read.
  if (repoFacts) demoteIfMatchesInference(next, repoFacts);

  return {
    next,
    changed: !isDeepEqual(compactUndefined({ ...raw }), compactUndefined({ ...next })),
  };
}

/**
 * Converts a legacy defaultBranch value to the structured stored shape,
 * matching how the legacy runtime interpreted the strings
 * (projectDefaultBranchToBranch): a known-remote prefix wins, then a
 * split-at-first-slash remote guess, then a local branch.
 */
function migrateDefaultBranch(
  value: LegacyBaseProjectSettings['defaultBranch'],
  storedBaseRemote: string | undefined,
  repoFacts: RepoFacts | null
): StoredDefaultBranch | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object') {
    if ('branch' in value) return value;
    // Legacy { name, remote: true }: "branch on the configured base remote".
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
      repoFacts,
      []
    ).baseRemote;
    if (inferred.provenance.kind === 'inferred' && inferred.value === next.baseRemote) {
      delete next.baseRemote;
    }
  }

  if (next.defaultBranch !== undefined) {
    const inferred = resolveEffectiveSettings(
      { project: { baseRemote: next.baseRemote }, builtInWorktreeRoot: '' },
      repoFacts,
      []
    ).defaultBranch;
    if (
      inferred.provenance.kind === 'inferred' &&
      isDeepEqual(inferred.value, next.defaultBranch)
    ) {
      delete next.defaultBranch;
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy in-memory view
// ---------------------------------------------------------------------------

/**
 * Maps a stored (or still partially legacy) row to the legacy in-memory
 * `BaseProjectSettings` surface the rest of the app consumes until the
 * resolver adoption lands: qualified-string defaultBranch, `worktreeDirectory`,
 * `githubAccountId` (explicit none → `null`, absent stays absent).
 */
export function toLegacyBaseSettingsView(
  stored: LegacyBaseProjectSettings | StoredBaseProjectSettings
): BaseProjectSettings {
  const {
    worktreeRoot,
    githubAccount,
    defaultBranch,
    remote: legacyRemote,
    ...rest
  } = stored as LegacyBaseProjectSettings;
  const view: BaseProjectSettings = { ...rest };

  if (worktreeRoot !== undefined) view.worktreeDirectory = worktreeRoot;
  if (view.baseRemote === undefined && legacyRemote !== undefined) {
    view.baseRemote = legacyRemote;
  }

  if (defaultBranch !== undefined) {
    view.defaultBranch =
      typeof defaultBranch === 'object' && 'branch' in defaultBranch
        ? formatDefaultBranch(defaultBranch)
        : defaultBranch;
  }

  if (githubAccount !== undefined) {
    view.githubAccountId = githubAccount.kind === 'account' ? githubAccount.accountId : null;
  }

  return view;
}

/**
 * Converts the legacy in-memory `BaseProjectSettings` shape (still produced by
 * update flows) back to the stored model for persistence. `githubAccountId`
 * keeps its legacy write semantics: string → account ref, explicit `null` →
 * explicit none, absent → absent (infer).
 */
export function legacyBaseSettingsToStored(base: BaseProjectSettings): StoredBaseProjectSettings {
  const { worktreeDirectory, defaultBranch, githubAccountId, ...rest } = base;
  const stored: StoredBaseProjectSettings = { ...rest };

  if (worktreeDirectory !== undefined) stored.worktreeRoot = worktreeDirectory;

  const migratedDefaultBranch = migrateDefaultBranch(defaultBranch, base.baseRemote, null);
  if (migratedDefaultBranch !== undefined) stored.defaultBranch = migratedDefaultBranch;

  if (githubAccountId !== undefined) {
    stored.githubAccount =
      githubAccountId === null ? { kind: 'none' } : { kind: 'account', accountId: githubAccountId };
  }

  return stored;
}
