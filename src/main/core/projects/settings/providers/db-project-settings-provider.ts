import type { FileSystemProvider } from '@main/core/fs/types';
import type { RepositoryGitProvider } from '@main/core/git/repository-git-provider';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { remoteNameFromQualifiedRef } from '@shared/git-utils';
import {
  baseProjectSettingsSchema,
  DEFAULT_PRESERVE_PATTERNS,
  legacyBaseProjectSettingsSchema,
  projectSettingsSchema,
  shareableProjectSettingsSchema,
  type BaseProjectSettings,
  type ProjectSettings,
  type ShareableProjectSettings,
} from '@shared/project-settings';
import { SHAREABLE_FIELD_ACCESSORS } from '@shared/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { migrateLegacyProjectSettingsIfNeeded } from '../legacy-project-settings-migration';
import { serializeShareableProjectSettings } from '../legacy-shareable-migration-marker';
import { compactUndefined, parseJsonObject, readJson } from '../project-settings-json';
import { ProjectSettingsRepository } from '../project-settings-storage';
import type { ProjectSettingsPatch, ProjectSettingsProvider } from '../provider';
import { CONFIG_FILE } from '../sharing/workspace-config-file';

export type DbProjectSettingsProviderOptions = {
  git?: Pick<RepositoryGitProvider, 'isFileCleanlyTracked'>;
};

export abstract class DbProjectSettingsProvider implements ProjectSettingsProvider {
  private legacyMigrationPromise: Promise<void> | undefined;
  private readonly storage = new ProjectSettingsRepository();

  protected constructor(
    private readonly projectId: string,
    protected readonly projectPath: string,
    protected readonly defaultBranchFallback: string = 'main',
    private readonly configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined,
    private readonly options: DbProjectSettingsProviderOptions = {}
  ) {}

  protected abstract defaultWorktreeDirectory(): Promise<string>;

  protected abstract validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>>;

  protected abstract normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>>;

  protected async initialBaseProjectSettings(): Promise<BaseProjectSettings> {
    const defaultBranch = this.defaultBranchFallback.trim() || 'main';
    const projectDefaults = await appSettingsService.get('project');
    return {
      defaultBranch,
      baseRemote: remoteNameFromQualifiedRef(defaultBranch) ?? 'origin',
      tmux: projectDefaults.tmuxByDefault,
    };
  }

  private async hasSharedPreservePatterns(): Promise<boolean> {
    if (!this.configReader) return false;
    try {
      if (!(await this.configReader.exists(CONFIG_FILE))) return false;
      const { content } = await this.configReader.read(CONFIG_FILE);
      const parsed = shareableProjectSettingsSchema.safeParse(parseJsonObject(content));
      if (!parsed.success) {
        log.warn('Failed to inspect shared project settings during initialization', parsed.error);
        return false;
      }
      return parsed.data.preservePatterns !== undefined;
    } catch (error) {
      log.warn('Failed to inspect shared project settings during initialization', error);
      return false;
    }
  }

  private async ensureRow(): Promise<void> {
    if (await this.storage.get(this.projectId)) return;

    const baseSettings = await this.initialBaseProjectSettings();
    const shareableSettings = (await this.hasSharedPreservePatterns())
      ? {}
      : { preservePatterns: [...DEFAULT_PRESERVE_PATTERNS] };
    await this.storage.insertIfMissing(this.projectId, {
      baseProjectSettingsJson: JSON.stringify(compactUndefined(baseSettings)),
      shareableProjectSettingsJson: serializeShareableProjectSettings(shareableSettings),
      legacyConfigMigratedAt: null,
    });
  }

  private async readSettingsRow(): Promise<{
    base: BaseProjectSettings;
    shareable: ShareableProjectSettings;
    legacyConfigMigratedAt: string | null;
  }> {
    await this.ensureRow();
    await this.migrateLegacyConfigIfNeeded();
    const row = await this.storage.get(this.projectId);
    if (!row) {
      return {
        base: await this.initialBaseProjectSettings(),
        shareable: {},
        legacyConfigMigratedAt: null,
      };
    }
    const baseSettings = readJson(
      row.baseProjectSettingsJson,
      legacyBaseProjectSettingsSchema,
      'base project settings'
    );
    const { remote, ...canonicalBaseSettings } = baseSettings;

    return {
      base: baseProjectSettingsSchema.parse({
        ...canonicalBaseSettings,
        baseRemote: canonicalBaseSettings.baseRemote ?? remote,
      }),
      shareable: readJson(
        row.shareableProjectSettingsJson,
        shareableProjectSettingsSchema,
        'shareable project settings'
      ),
      legacyConfigMigratedAt: row.legacyConfigMigratedAt,
    };
  }

  private async migrateLegacyConfigIfNeeded(): Promise<void> {
    if (this.legacyMigrationPromise) {
      await this.legacyMigrationPromise;
      return;
    }

    this.legacyMigrationPromise = (async () => {
      const row = await this.storage.get(this.projectId);
      await migrateLegacyProjectSettingsIfNeeded({
        projectId: this.projectId,
        row,
        configReader: this.configReader,
        defaultBranchFallback: this.defaultBranchFallback,
        storage: this.storage,
        git: this.options.git,
        normalizeStoredWorktreeDirectory: (worktreeDirectory) =>
          this.normalizeStoredWorktreeDirectory(worktreeDirectory),
      });
    })();

    try {
      await this.legacyMigrationPromise;
    } catch (error) {
      this.legacyMigrationPromise = undefined;
      throw error;
    }
  }

  async ensure(): Promise<void> {
    await this.ensureRow();
    await this.migrateLegacyConfigIfNeeded();
  }

  async get(): Promise<ProjectSettings> {
    const { base, shareable } = await this.readSettingsRow();
    return projectSettingsSchema.parse({ ...base, ...shareable });
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const parsed = projectSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      return err({ type: 'invalid-settings' });
    }

    const nextSettings = parsed.data;
    const worktreeDirectoryResult = await this.validateWorktreeDirectory(
      nextSettings.worktreeDirectory
    );
    if (!worktreeDirectoryResult.success) {
      return worktreeDirectoryResult;
    }
    nextSettings.worktreeDirectory = worktreeDirectoryResult.data;

    const base = baseProjectSettingsSchema.parse(nextSettings);
    const shareable = shareableProjectSettingsSchema.parse(nextSettings);

    try {
      await this.ensure();
      const row = await this.storage.get(this.projectId);
      await this.storage.update(this.projectId, {
        baseProjectSettingsJson: JSON.stringify(compactUndefined(base)),
        shareableProjectSettingsJson: serializeShareableProjectSettings(shareable, {
          previousRaw: row?.shareableProjectSettingsJson,
        }),
      });
      return ok();
    } catch (error) {
      log.warn('Failed to update project settings', error);
      return err({ type: 'error' });
    }
  }

  async patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>> {
    try {
      await this.ensure();
      const row = await this.storage.get(this.projectId);
      const base = row
        ? readJson(
            row.baseProjectSettingsJson,
            legacyBaseProjectSettingsSchema,
            'base project settings'
          )
        : await this.initialBaseProjectSettings();
      const shareable = row
        ? readJson(
            row.shareableProjectSettingsJson,
            shareableProjectSettingsSchema,
            'shareable project settings'
          )
        : {};

      for (const field of patch.clearShareableFields ?? []) {
        SHAREABLE_FIELD_ACCESSORS[field].clear(shareable);
      }

      const nextBase = baseProjectSettingsSchema.parse({
        ...base,
        ...(Object.hasOwn(patch, 'githubAccountId')
          ? { githubAccountId: patch.githubAccountId }
          : {}),
      });

      await this.storage.update(this.projectId, {
        baseProjectSettingsJson: JSON.stringify(compactUndefined(nextBase)),
        shareableProjectSettingsJson: serializeShareableProjectSettings(shareable, {
          previousRaw: row?.shareableProjectSettingsJson,
        }),
      });
      return ok();
    } catch (error) {
      log.warn('Failed to clear shareable project settings', error);
      return err({ type: 'error' });
    }
  }

  async getDefaultBranch(): Promise<string> {
    const settings = await this.get();
    const branch = settings.defaultBranch;
    if (!branch) return this.defaultBranchFallback;
    if (typeof branch === 'string') return branch;
    const remote = settings.baseRemote ?? 'origin';
    return `${remote}/${branch.name}`;
  }

  async getBaseRemote(): Promise<string> {
    const settings = await this.get();
    return settings.baseRemote ?? 'origin';
  }

  async getPushRemote(): Promise<string> {
    const settings = await this.get();
    return settings.pushRemote ?? settings.baseRemote ?? 'origin';
  }

  async getDefaultWorktreeDirectory(): Promise<string> {
    return this.defaultWorktreeDirectory();
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    const defaultWorktreeDirectory = await this.getDefaultWorktreeDirectory();
    if (settings.worktreeDirectory) {
      const normalized = await this.normalizeStoredWorktreeDirectory(settings.worktreeDirectory);
      if (normalized.success) {
        return normalized.data;
      }
      log.warn('ProjectSettingsProvider: invalid worktreeDirectory, falling back to default', {
        worktreeDirectory: settings.worktreeDirectory,
        defaultWorktreeDirectory,
        error: normalized.error.type,
      });
    }
    return defaultWorktreeDirectory;
  }
}
