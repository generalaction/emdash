import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getDefaultSshWorktreeDirectory } from '@main/core/settings/worktree-defaults';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import {
  projectSettingsSchema,
  type ProjectSettings,
  type ProjectSettingsProvider,
} from './schema';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
} from './worktree-directory';

const defaults = () => projectSettingsSchema.parse({});

function parseSettingsOrDefault(raw: string, source: string): ProjectSettings {
  try {
    return projectSettingsSchema.parse(JSON.parse(raw));
  } catch (err) {
    log.warn(`Failed to parse ${source}, using defaults`, err);
    return defaults();
  }
}

export class LocalProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(
    private readonly projectPath: string,
    private readonly defaultBranchFallback: string = 'main'
  ) {}

  async get(): Promise<ProjectSettings> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      return defaults();
    }
    return parseSettingsOrDefault(fs.readFileSync(settingsPath, 'utf8'), settingsPath);
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const parsed = projectSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      return err({ type: 'invalid-settings' });
    }
    const nextSettings = parsed.data;
    const worktreeDirectoryResult = await resolveAndValidateWorktreeDirectory(
      nextSettings.worktreeDirectory,
      {
        projectPath: this.projectPath,
        pathApi: path,
        fs: {
          mkdir: async (p, options) => {
            await fs.promises.mkdir(p, options);
          },
          realPath: async (p) => fs.promises.realpath(p),
        },
        homeDirectory: os.homedir(),
      }
    );
    if (!worktreeDirectoryResult.success) {
      return worktreeDirectoryResult;
    }

    nextSettings.worktreeDirectory = worktreeDirectoryResult.data;

    try {
      const settingsPath = path.join(this.projectPath, '.emdash.json');
      fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2));
      return ok();
    } catch {
      return err({ type: 'error' });
    }
  }

  async ensure(): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    const settings = await this.get();
    const branch = settings.defaultBranch;
    if (!branch) return this.defaultBranchFallback;
    return typeof branch === 'string' ? branch : branch.name;
  }

  async getRemote(): Promise<string> {
    const settings = await this.get();
    return settings.remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    const defaultWorktreeDirectory = (await appSettingsService.get('localProject'))
      .defaultWorktreeDirectory;
    if (settings.worktreeDirectory) {
      const normalized = await normalizeWorktreeDirectory(settings.worktreeDirectory, {
        projectPath: this.projectPath,
        pathApi: path,
        homeDirectory: os.homedir(),
      });
      if (normalized.success) {
        return normalized.data;
      }
      {
        log.warn(
          'LocalProjectSettingsProvider: invalid worktreeDirectory, falling back to default',
          {
            worktreeDirectory: settings.worktreeDirectory,
            defaultWorktreeDirectory,
            error: normalized.error.type,
          }
        );
      }
    }
    return defaultWorktreeDirectory;
  }
}

export class SshProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(
    private readonly fs: SshFileSystem,
    private readonly defaultBranchFallback: string = 'main',
    private readonly rootFs?: Pick<FileSystemProvider, 'mkdir' | 'realPath'>,
    private readonly projectPath: string = '/',
    private readonly exec?: ExecFn
  ) {}

  private homeDirectory?: Promise<string>;

  private async getHomeDirectory(): Promise<Result<string, UpdateProjectSettingsError>> {
    if (!this.exec) {
      return err({ type: 'invalid-worktree-directory' });
    }
    try {
      this.homeDirectory ??= resolveRemoteHome(this.exec);
      return ok(await this.homeDirectory);
    } catch {
      return err({ type: 'invalid-worktree-directory' });
    }
  }

  async get(): Promise<ProjectSettings> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      return defaults();
    }

    return parseSettingsOrDefault(
      (await this.fs.read('.emdash.json')).content,
      '.emdash.json (ssh)'
    );
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const parsed = projectSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      return err({ type: 'invalid-settings' });
    }
    const nextSettings = parsed.data;
    if (!this.rootFs) {
      return err({ type: 'error' });
    }
    const worktreeDirectoryResult = await resolveAndValidateWorktreeDirectory(
      nextSettings.worktreeDirectory,
      {
        projectPath: this.projectPath,
        pathApi: path.posix,
        fs: this.rootFs,
        resolveHomeDirectory: async () => {
          const homeDirectory = await this.getHomeDirectory();
          return homeDirectory.success ? homeDirectory.data : '';
        },
      }
    );
    if (!worktreeDirectoryResult.success) {
      return worktreeDirectoryResult;
    }

    nextSettings.worktreeDirectory = worktreeDirectoryResult.data;
    try {
      await this.fs.write('.emdash.json', JSON.stringify(nextSettings, null, 2));
      return ok();
    } catch {
      return err({ type: 'error' });
    }
  }

  async ensure(): Promise<void> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      await this.fs.write('.emdash.json', JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    const settings = await this.get();
    const branch = settings.defaultBranch;
    if (!branch) return this.defaultBranchFallback;
    return typeof branch === 'string' ? branch : branch.name;
  }

  async getRemote(): Promise<string> {
    const settings = await this.get();
    return settings.remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    const defaultWorktreeDirectory = getDefaultSshWorktreeDirectory(this.projectPath);
    if (settings.worktreeDirectory) {
      const normalized = await normalizeWorktreeDirectory(settings.worktreeDirectory, {
        projectPath: this.projectPath,
        pathApi: path.posix,
        resolveHomeDirectory: async () => {
          const homeDirectory = await this.getHomeDirectory();
          return homeDirectory.success ? homeDirectory.data : '';
        },
      });
      if (normalized.success) {
        if (this.rootFs) {
          try {
            await this.rootFs.mkdir(normalized.data, { recursive: true });
          } catch {
            log.warn(
              'SshProjectSettingsProvider: inaccessible worktreeDirectory, falling back to default',
              {
                worktreeDirectory: settings.worktreeDirectory,
                defaultWorktreeDirectory,
              }
            );
            return defaultWorktreeDirectory;
          }
        }
        return normalized.data;
      }
      {
        log.warn('SshProjectSettingsProvider: invalid worktreeDirectory, falling back to default', {
          worktreeDirectory: settings.worktreeDirectory,
          defaultWorktreeDirectory,
          error: normalized.error.type,
        });
      }
    }
    return defaultWorktreeDirectory;
  }
}
