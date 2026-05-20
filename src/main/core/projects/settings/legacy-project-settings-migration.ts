import type { FileSystemProvider } from '@main/core/fs/types';
import type { RepositoryGitProvider } from '@main/core/git/repository-git-provider';
import { log } from '@main/lib/logger';
import { remoteNameFromQualifiedRef } from '@shared/git-utils';
import {
  baseProjectSettingsSchema,
  legacyBaseProjectSettingsSchema,
  legacyProjectConfigSchema,
  shareableProjectSettingsSchema,
  type BaseProjectSettings,
  type ShareableProjectSettings,
} from '@shared/project-settings';
import { mergeShareableProjectSettings } from '@shared/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import {
  hasLegacyShareableConfigMigrated,
  serializeShareableProjectSettings,
} from './legacy-shareable-migration-marker';
import { compactUndefined, parseJsonObject, readJson } from './project-settings-json';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';

export type LegacyProjectSettingsMigrationArgs = {
  projectId: string;
  row: StoredProjectSettings | undefined;
  configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined;
  defaultBranchFallback: string;
  storage: ProjectSettingsStorage;
  git?: Pick<RepositoryGitProvider, 'isFileCleanlyTracked'>;
  normalizeStoredWorktreeDirectory: (
    worktreeDirectory: string
  ) => Promise<Result<string, UpdateProjectSettingsError>>;
};

function normalizeLegacyDefaultBranch(
  branch: BaseProjectSettings['defaultBranch'],
  remote: string | undefined,
  fallback: string
): BaseProjectSettings['defaultBranch'] {
  if (!branch) return undefined;
  const branchName = typeof branch === 'string' ? branch.trim() : branch.name.trim();
  if (!branchName) return undefined;
  if (branchName.includes('/')) return branchName;
  const remoteName = remote?.trim() || remoteNameFromQualifiedRef(fallback) || undefined;
  return remoteName ? `${remoteName}/${branchName}` : branchName;
}

async function readLegacyProjectConfig(
  configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined
): Promise<
  | (BaseProjectSettings & {
      remote?: string;
    })
  | undefined
> {
  if (!configReader) return undefined;
  try {
    if (!(await configReader.exists('.emdash.json'))) return undefined;
    const { content } = await configReader.read('.emdash.json');
    const parsed = legacyProjectConfigSchema.safeParse(parseJsonObject(content));
    if (!parsed.success) {
      log.warn('Failed to parse legacy .emdash.json for migration', parsed.error);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    log.warn('Failed to read legacy .emdash.json for migration', error);
    return undefined;
  }
}

export async function migrateLegacyProjectSettingsIfNeeded({
  projectId,
  row,
  configReader,
  defaultBranchFallback,
  storage,
  git,
  normalizeStoredWorktreeDirectory,
}: LegacyProjectSettingsMigrationArgs): Promise<void> {
  if (!row) return;

  const baseAlreadyMigrated = Boolean(row.legacyConfigMigratedAt);
  const shareableAlreadyMigrated = hasLegacyShareableConfigMigrated(
    row.shareableProjectSettingsJson
  );
  if (baseAlreadyMigrated && shareableAlreadyMigrated) return;

  const current = readJson(
    row.baseProjectSettingsJson,
    legacyBaseProjectSettingsSchema,
    'base project settings'
  );
  const currentShareable = readJson(
    row.shareableProjectSettingsJson,
    shareableProjectSettingsSchema,
    'shareable project settings'
  );
  const { remote, ...currentSettings } = current;
  const legacy = await readLegacyProjectConfig(configReader);
  const next: BaseProjectSettings = baseProjectSettingsSchema.parse({
    ...currentSettings,
    baseRemote: currentSettings.baseRemote ?? remote,
  });
  let nextShareable: ShareableProjectSettings | undefined;

  if (legacy && !baseAlreadyMigrated) {
    if (legacy.worktreeDirectory !== undefined) {
      const normalized = await normalizeStoredWorktreeDirectory(legacy.worktreeDirectory);
      if (normalized.success) next.worktreeDirectory = normalized.data;
    }
    if (legacy.remote !== undefined) next.baseRemote = legacy.remote;
    if (legacy.baseRemote !== undefined) next.baseRemote = legacy.baseRemote;
    if (legacy.pushRemote !== undefined) next.pushRemote = legacy.pushRemote;
    if (legacy.defaultBranch !== undefined) {
      next.defaultBranch = normalizeLegacyDefaultBranch(
        legacy.defaultBranch,
        legacy.baseRemote ?? legacy.remote ?? next.baseRemote,
        defaultBranchFallback
      );
    }
    if (legacy.tmux !== undefined) next.tmux = legacy.tmux;
    if (legacy.workspaceProvider !== undefined) {
      next.workspaceProvider = legacy.workspaceProvider;
    }
  }

  if (legacy && !shareableAlreadyMigrated) {
    if ((await git?.isFileCleanlyTracked('.emdash.json')) === false) {
      const legacyShareable = shareableProjectSettingsSchema.parse(legacy);
      nextShareable = mergeShareableProjectSettings(currentShareable, legacyShareable);
    }
  }

  const update: Partial<StoredProjectSettings> = {
    ...(nextShareable
      ? {
          shareableProjectSettingsJson: serializeShareableProjectSettings(nextShareable, {
            previousRaw: row.shareableProjectSettingsJson,
            markLegacyShareableConfigMigrated: true,
          }),
        }
      : {}),
  };

  if (!baseAlreadyMigrated) {
    update.baseProjectSettingsJson = JSON.stringify(compactUndefined(next));
    update.legacyConfigMigratedAt = new Date().toISOString();
  }

  if (Object.keys(update).length > 0) {
    await storage.update(projectId, update);
  }
}
