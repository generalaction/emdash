import fs from 'node:fs';
import path from 'node:path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { ProjectSettings, ProjectSettingsProvider, projectSettingsSchema } from './schema';

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

  async update(settings: ProjectSettings): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  async ensure(): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    const settings = await this.get();
    return settings.defaultBranch ?? this.defaultBranchFallback;
  }

  async getRemote(): Promise<string> {
    const settings = await this.get();
    return settings.remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    if (settings.worktreeDirectory) {
      return settings.worktreeDirectory;
    }
    return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
  }
}

export class SshProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(
    private readonly fs: SshFileSystem,
    private readonly defaultBranchFallback: string = 'main'
  ) {}

  async get(): Promise<ProjectSettings> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      const defaultSettings = defaults();
      await this.fs.write('.emdash.json', JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }

    return parseSettingsOrDefault(
      (await this.fs.read('.emdash.json')).content,
      '.emdash.json (ssh)'
    );
  }

  async update(settings: ProjectSettings): Promise<void> {
    await this.fs.write('.emdash.json', JSON.stringify(settings, null, 2));
  }

  async ensure(): Promise<void> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      await this.fs.write('.emdash.json', JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    const settings = await this.get();
    return settings.defaultBranch ?? this.defaultBranchFallback;
  }

  async getRemote(): Promise<string> {
    const settings = await this.get();
    return settings.remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    if (settings.worktreeDirectory) {
      return settings.worktreeDirectory;
    }
    return path.join('emdash', 'worktrees');
  }
}
