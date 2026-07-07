import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { appSettingsService } from '@main/core/settings/settings-service';
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
    configReader: Pick<IFileSystem, 'exists' | 'readText'>,
    options: DbProjectSettingsProviderOptions = {}
  ) {
    super(projectId, projectPath, defaultBranchFallback, configReader, path.join, options);
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
          try {
            await fs.promises.mkdir(p, options);
            return ok();
          } catch (error: unknown) {
            return err({ message: error instanceof Error ? error.message : String(error) });
          }
        },
        realPath: async (p) => {
          try {
            return ok(await fs.promises.realpath(p));
          } catch (error: unknown) {
            return err({ message: error instanceof Error ? error.message : String(error) });
          }
        },
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
