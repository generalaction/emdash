import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { remoteNameFromQualifiedRef } from '@shared/git-utils';
import {
  baseProjectSettingsSchema,
  DEFAULT_PRESERVE_PATTERNS,
  projectSettingsSchema,
  shareableProjectSettingsSchema,
  type BaseProjectSettings,
  type ProjectSettings,
  type ShareableProjectSettings,
} from '@shared/project-settings';
import { SHAREABLE_FIELD_ACCESSORS } from '@shared/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getDefaultSshWorktreeDirectory } from '@main/core/settings/worktree-defaults';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { log } from '@main/lib/logger';
import { migrateLegacyProjectSettingsIfNeeded } from './legacy-project-settings-migration';
import { compactUndefined, parseJsonObject, readJson } from './project-settings-json';
import { ProjectSettingsRepository, type ProjectSettingsStorage } from './project-settings-storage';
import type { ProjectSettingsPatch, ProjectSettingsProvider } from './provider';
import { CONFIG_FILE } from './workspace-config-file';
import {
  canonicalizeWorktreeDirectory,
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
} from './worktree-directory';

async function getLocalDefaultWorktreeDirectory(): Promise<string> {
  return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
}

const localPathPlatform = process.platform === 'win32' ? 'win32' : 'posix';

abstract class DbProjectSettingsProvider implements ProjectSettingsProvider {
  private legacyMigrationPromise: Promise<void> | undefined;

  protected constructor(
    private readonly projectId: string,
    protected readonly projectPath: string,
    protected readonly defaultBranchFallback: string = 'main',
    private readonly configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined,
    private readonly storage: ProjectSettingsStorage = new ProjectSettingsRepository()
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
      remote: remoteNameFromQualifiedRef(defaultBranch) ?? 'origin',
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
      shareableProjectSettingsJson: JSON.stringify(compactUndefined(shareableSettings)),
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
    return {
      base: readJson(
        row.baseProjectSettingsJson,
        baseProjectSettingsSchema,
        'base project settings'
      ),
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
      await this.storage.update(this.projectId, {
        baseProjectSettingsJson: JSON.stringify(compactUndefined(base)),
        shareableProjectSettingsJson: JSON.stringify(compactUndefined(shareable)),
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

      await this.storage.update(this.projectId, {
        shareableProjectSettingsJson: JSON.stringify(compactUndefined(shareable)),
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
    const remote = settings.remote ?? 'origin';
    return `${remote}/${branch.name}`;
  }

  async getRemote(): Promise<string> {
    const settings = await this.get();
    return settings.remote ?? 'origin';
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

export class LocalProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    projectPath: string,
    defaultBranchFallback: string = 'main',
    storage?: ProjectSettingsStorage
  ) {
    super(
      projectId,
      projectPath,
      defaultBranchFallback,
      {
        exists: async (filePath) => fs.existsSync(path.join(projectPath, filePath)),
        read: async (filePath) => {
          const content = await fs.promises.readFile(path.join(projectPath, filePath), 'utf8');
          return { content, truncated: false, totalSize: Buffer.byteLength(content) };
        },
      },
      storage
    );
  }

  protected defaultWorktreeDirectory(): Promise<string> {
    return getLocalDefaultWorktreeDirectory();
  }

  protected validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    return resolveAndValidateWorktreeDirectory(worktreeDirectory, {
      pathApi: path,
      pathPlatform: localPathPlatform,
      fs: {
        mkdir: async (p, options) => {
          await fs.promises.mkdir(p, options);
        },
        realPath: async (p) => fs.promises.realpath(p),
      },
      homeDirectory: os.homedir(),
    });
  }

  protected normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    return normalizeWorktreeDirectory(worktreeDirectory, {
      pathApi: path,
      pathPlatform: localPathPlatform,
      homeDirectory: os.homedir(),
    });
  }
}

export class SshProjectSettingsProvider extends DbProjectSettingsProvider {
  private homeDirectory?: Promise<string>;

  constructor(
    projectId: string,
    private readonly fs: SshFileSystem,
    defaultBranchFallback: string = 'main',
    private readonly rootFs?: Pick<FileSystemProvider, 'mkdir' | 'realPath'>,
    projectPath: string = '/',
    private readonly ctx?: IExecutionContext,
    storage?: ProjectSettingsStorage
  ) {
    super(projectId, projectPath, defaultBranchFallback, fs, storage);
  }

  private async getHomeDirectory(): Promise<Result<string, UpdateProjectSettingsError>> {
    if (!this.ctx) {
      return err({ type: 'invalid-worktree-directory' });
    }
    try {
      this.homeDirectory ??= resolveRemoteHome(this.ctx);
      return ok(await this.homeDirectory);
    } catch {
      return err({ type: 'invalid-worktree-directory' });
    }
  }

  protected async defaultWorktreeDirectory(): Promise<string> {
    return getDefaultSshWorktreeDirectory(this.projectPath);
  }

  protected async validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    if (!this.rootFs) {
      return err({ type: 'error' });
    }
    return resolveAndValidateWorktreeDirectory(worktreeDirectory, {
      pathApi: path.posix,
      pathPlatform: 'posix',
      fs: this.rootFs,
      resolveHomeDirectory: async () => {
        const homeDirectory = await this.getHomeDirectory();
        return homeDirectory.success ? homeDirectory.data : '';
      },
    });
  }

  protected async normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    const normalized = await normalizeWorktreeDirectory(worktreeDirectory, {
      pathApi: path.posix,
      pathPlatform: 'posix',
      resolveHomeDirectory: async () => {
        const homeDirectory = await this.getHomeDirectory();
        return homeDirectory.success ? homeDirectory.data : '';
      },
    });
    if (!normalized.success) return normalized;

    if (this.rootFs) {
      return canonicalizeWorktreeDirectory(normalized.data, this.rootFs);
    }
    return normalized;
  }
}
