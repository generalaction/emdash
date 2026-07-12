import type { Result } from '@emdash/shared';
import { fileKey, type FilesClientScope } from '@main/core/files/runtime-process/client';
import { log } from '@main/lib/logger';
import { remoteNameFromQualifiedRef } from '@shared/core/git/utils';
import {
  baseProjectSettingsSchema,
  legacyBaseProjectSettingsSchema,
  legacyProjectConfigSchema,
  shareableProjectSettingsSchema,
  type BaseProjectSettings,
  type ShareableProjectSettings,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  hasLegacyShareableConfigMigrated,
  serializeShareableProjectSettings,
} from './legacy-shareable-migration-marker';
import { compactUndefined, parseJsonObject, readJson } from './project-settings-json';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';

export type LegacyProjectSettingsMigrationArgs = {
  projectId: string;
  row: StoredProjectSettings | undefined;
  configFiles: FilesClientScope | undefined;
  configPath: string;
  defaultBranchFallback: string;
  storage: ProjectSettingsStorage;
  git?: ProjectSettingsGitInspector;
  normalizeStoredWorktreeDirectory: (
    worktreeDirectory: string
  ) => Promise<Result<string, UpdateProjectSettingsError>>;
};

export type ProjectSettingsGitInspector = {
  isFileCleanlyTracked(filePath: string): Promise<boolean>;
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
  configFiles: FilesClientScope | undefined,
  configPath: string
): Promise<
  | (BaseProjectSettings & {
      remote?: string;
    })
  | undefined
> {
  if (!configFiles) return undefined;
  try {
    const exists = await configFiles.client.fs.exists(fileKey(configFiles, configPath));
    if (!exists.success) {
      log.warn('Failed to check legacy .emdash.json for migration', exists.error);
      return undefined;
    }
    if (!exists.data) return undefined;
    const content = await configFiles.client.fs.readText(fileKey(configFiles, configPath));
    if (!content.success) {
      log.warn('Failed to read legacy .emdash.json for migration', content.error);
      return undefined;
    }
    if (content.data.truncated) {
      log.warn('Legacy .emdash.json was truncated during migration', {
        path: configPath,
        totalSize: content.data.totalSize,
      });
      return undefined;
    }
    const parsed = legacyProjectConfigSchema.safeParse(parseJsonObject(content.data.content));
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
  configFiles,
  configPath,
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
  const legacy = await readLegacyProjectConfig(configFiles, configPath);
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
    if ((await git?.isFileCleanlyTracked(configPath)) === false) {
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
