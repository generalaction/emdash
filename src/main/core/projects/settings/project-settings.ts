import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getDefaultSshWorktreeDirectory } from '@main/core/settings/worktree-defaults';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { ProjectSettings, ProjectSettingsProvider, projectSettingsSchema } from './schema';
import {
  defaultLocalWorktreeFs,
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
    private readonly defaultBranchFallback: string = 'main',
    private readonly rootFs?: Pick<FileSystemProvider, 'mkdir' | 'realPath'>
  ) {}

  async get(): Promise<ProjectSettings> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      return defaults();
    }
    return parseSettingsOrDefault(fs.readFileSync(settingsPath, 'utf8'), settingsPath);
  }

  async update(settings: ProjectSettings): Promise<void> {
    const nextSettings = projectSettingsSchema.parse(settings);
    try {
      nextSettings.worktreeDirectory = await resolveAndValidateWorktreeDirectory(
        nextSettings.worktreeDirectory,
        {
          projectPath: this.projectPath,
          pathApi: path,
          fs: this.rootFs ?? defaultLocalWorktreeFs,
          homeDirectory: os.homedir(),
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid worktree directory: ${message}`);
    }

    const settingsPath = path.join(this.projectPath, '.emdash.json');
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2));
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
      try {
        return await normalizeWorktreeDirectory(settings.worktreeDirectory, {
          projectPath: this.projectPath,
          pathApi: path,
          homeDirectory: os.homedir(),
        });
      } catch (error: unknown) {
        log.warn(
          'LocalProjectSettingsProvider: invalid worktreeDirectory, falling back to default',
          {
            worktreeDirectory: settings.worktreeDirectory,
            defaultWorktreeDirectory,
            error: String(error),
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

  private async getHomeDirectory(): Promise<string> {
    if (!this.exec) {
      throw new Error('Unable to resolve remote home directory for SSH project');
    }
    this.homeDirectory ??= resolveRemoteHome(this.exec);
    return this.homeDirectory;
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

  async update(settings: ProjectSettings): Promise<void> {
    const nextSettings = projectSettingsSchema.parse(settings);
    if (!this.rootFs) {
      throw new Error('Unable to validate worktree directory for SSH project');
    }
    try {
      nextSettings.worktreeDirectory = await resolveAndValidateWorktreeDirectory(
        nextSettings.worktreeDirectory,
        {
          projectPath: this.projectPath,
          pathApi: path.posix,
          fs: this.rootFs,
          resolveHomeDirectory: () => this.getHomeDirectory(),
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid worktree directory: ${message}`);
    }

    await this.fs.write('.emdash.json', JSON.stringify(nextSettings, null, 2));
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
      try {
        return await normalizeWorktreeDirectory(settings.worktreeDirectory, {
          projectPath: this.projectPath,
          pathApi: path.posix,
          resolveHomeDirectory: () => this.getHomeDirectory(),
        });
      } catch (error: unknown) {
        log.warn('SshProjectSettingsProvider: invalid worktreeDirectory, falling back to default', {
          worktreeDirectory: settings.worktreeDirectory,
          defaultWorktreeDirectory,
          error: String(error),
        });
      }
    }
    return defaultWorktreeDirectory;
  }
}
