import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { getDefaultSshWorktreeDirectory } from '@main/core/settings/worktree-defaults';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  canonicalizeWorktreeDirectory,
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
} from '../worktree-directory';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

export class SshProjectSettingsProvider extends DbProjectSettingsProvider {
  private homeDirectory?: Promise<string>;

  constructor(
    projectId: string,
    fs: Pick<IFileSystem, 'exists' | 'readText'>,
    defaultBranchFallback: string = 'main',
    private readonly rootFs?: {
      mkdir(
        path: string,
        options?: { recursive?: boolean }
      ): Promise<Result<void, { message: string }>>;
      realPath(path: string): Promise<Result<string, { message: string }>>;
    },
    projectPath: string = '/',
    private readonly ctx?: IExecutionContext,
    options: DbProjectSettingsProviderOptions = {}
  ) {
    super(projectId, projectPath, defaultBranchFallback, fs, path.posix.join, options);
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
