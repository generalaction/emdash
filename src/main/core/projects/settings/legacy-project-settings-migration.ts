import { remoteNameFromQualifiedRef } from '@shared/git-utils';
import {
  baseProjectSettingsSchema,
  legacyBaseProjectSettingsSchema,
  legacyProjectConfigSchema,
  type BaseProjectSettings,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import { compactUndefined, parseJsonObject, readJson } from './project-settings-json';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';

export type LegacyProjectSettingsMigrationArgs = {
  projectId: string;
  row: StoredProjectSettings | undefined;
  configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined;
  defaultBranchFallback: string;
  storage: ProjectSettingsStorage;
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
  normalizeStoredWorktreeDirectory,
}: LegacyProjectSettingsMigrationArgs): Promise<void> {
  if (!row || row.legacyConfigMigratedAt) return;

  const current = readJson(
    row.baseProjectSettingsJson,
    legacyBaseProjectSettingsSchema,
    'base project settings'
  );
  const { remote, ...currentSettings } = current;
  const legacy = await readLegacyProjectConfig(configReader);
  const next: BaseProjectSettings = baseProjectSettingsSchema.parse({
    ...currentSettings,
    baseRemote: currentSettings.baseRemote ?? remote,
  });

  if (legacy) {
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

  await storage.update(projectId, {
    baseProjectSettingsJson: JSON.stringify(compactUndefined(next)),
    legacyConfigMigratedAt: new Date().toISOString(),
  });
}
