import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { Result } from '@shared/lib/result';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
} from '../worktree-directory';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

async function getLocalDefaultWorktreeDirectory(): Promise<string> {
  return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
}

const localPathPlatform = process.platform === 'win32' ? 'win32' : 'posix';

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
