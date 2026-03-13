import fs from 'node:fs';
import path from 'node:path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { appSettingsService } from '@main/core/settings/settings-service';
import { ProjectSettings, ProjectSettingsProvider, projectSettingsSchema } from './schema';

export class LocalProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(private readonly projectPath: string) {}

  async get(): Promise<ProjectSettings> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings = projectSettingsSchema.parse(JSON.parse('{}'));
      return defaultSettings;
    }
    const settings = projectSettingsSchema.parse(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    return settings;
  }

  async update(settings: ProjectSettings): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  async ensure(): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.emdash.json');
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings = projectSettingsSchema.parse(JSON.parse('{}'));
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    }
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
  constructor(private readonly fs: SshFileSystem) {}

  async get(): Promise<ProjectSettings> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      const defaultSettings = projectSettingsSchema.parse(JSON.parse('{}'));
      await this.fs.write('.emdash.json', JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }

    const settings = projectSettingsSchema.parse(
      JSON.parse((await this.fs.read('.emdash.json')).content)
    );
    return settings;
  }

  async update(settings: ProjectSettings): Promise<void> {
    await this.fs.write('.emdash.json', JSON.stringify(settings, null, 2));
  }

  async ensure(): Promise<void> {
    const exists = await this.fs.exists('.emdash.json');
    if (!exists) {
      const defaultSettings = projectSettingsSchema.parse(JSON.parse('{}'));
      await this.fs.write('.emdash.json', JSON.stringify(defaultSettings, null, 2));
    }
  }

  async getWorktreeDirectory(): Promise<string> {
    const settings = await this.get();
    if (settings.worktreeDirectory) {
      return settings.worktreeDirectory;
    }
    return path.join('emdash', 'worktrees');
  }
}
