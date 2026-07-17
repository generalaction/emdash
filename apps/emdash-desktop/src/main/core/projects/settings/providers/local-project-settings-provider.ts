import os from 'node:os';
import path from 'node:path';
import type { Result } from '@emdash/shared';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { FilesClientScope } from '@main/core/files/runtime-client';
import { appSettingsService } from '@main/core/settings/settings-service';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
  type WorktreeDirectoryFileSystem,
} from '../worktree-directory';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

async function getLocalDefaultWorktreeDirectory(): Promise<string> {
  return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
}

const localPathPlatform = process.platform === 'win32' ? 'win32' : 'posix';

export type LocalProjectSettingsProviderOptions = DbProjectSettingsProviderOptions & {
  worktreeDirectoryFileSystem: WorktreeDirectoryFileSystem;
};

export class LocalProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    projectPath: string,
    defaultBranchFallback: string = 'main',
    files: FilesClientScope,
    private readonly localOptions: LocalProjectSettingsProviderOptions
  ) {
    super(projectId, projectPath, defaultBranchFallback, files, path.join, localOptions);
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
      fs: this.localOptions.worktreeDirectoryFileSystem,
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
