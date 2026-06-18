import fs from 'node:fs';
import path from 'node:path';
import type { Result } from '@emdash/shared';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  normalizeStoredLocalWorktreeDirectory,
  resolveAndValidateLocalWorktreeDirectory,
} from '../local-worktree-directory';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

async function getLocalDefaultWorktreeDirectory(): Promise<string> {
  return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
}

export class LocalProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    projectPath: string,
    defaultBranchFallback: string = 'main',
    options: DbProjectSettingsProviderOptions = {}
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
      options
    );
  }

  protected defaultWorktreeDirectory(): Promise<string> {
    return getLocalDefaultWorktreeDirectory();
  }

  protected validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    return resolveAndValidateLocalWorktreeDirectory(worktreeDirectory);
  }

  protected normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    return normalizeStoredLocalWorktreeDirectory(worktreeDirectory);
  }
}
