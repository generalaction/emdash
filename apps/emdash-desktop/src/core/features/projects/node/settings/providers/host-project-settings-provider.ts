import type { Result } from '@emdash/shared';
import { hostPathFromNative, joinHostPath } from '@core/primitives/desktop-runtime/api';
import type { PlacementContext } from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
  type WorktreeDirectoryFileSystem,
} from '../worktree-directory';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

export type HostProjectSettingsProviderOptions = DbProjectSettingsProviderOptions & {
  placementContext(): Promise<PlacementContext>;
  worktreeDirectoryFileSystem: WorktreeDirectoryFileSystem;
};

export class HostProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    projectPath: string,
    /** Creation-time base ref (creation provenance); null when unknown. */
    defaultBranchFallback: string | null,
    files: FilesClientScope,
    private readonly hostOptions: HostProjectSettingsProviderOptions
  ) {
    super(projectId, projectPath, defaultBranchFallback, files, joinHostPath, hostOptions);
  }

  protected placementContext(): Promise<PlacementContext> {
    return this.hostOptions.placementContext();
  }

  protected async validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    const placement = await this.hostOptions.placementContext();
    return resolveAndValidateWorktreeDirectory(worktreeDirectory, {
      pathApi: { join: joinHostPath },
      pathPlatform: pathPlatformFor(placement),
      fs: this.hostOptions.worktreeDirectoryFileSystem,
      homeDirectory: placement.homeDirectory,
    });
  }

  protected async normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    const placement = await this.hostOptions.placementContext();
    return normalizeWorktreeDirectory(worktreeDirectory, {
      pathApi: { join: joinHostPath },
      pathPlatform: pathPlatformFor(placement),
      homeDirectory: placement.homeDirectory,
    });
  }
}

function pathPlatformFor(placement: PlacementContext): 'posix' | 'win32' {
  if (placement.pathProfile) return placement.pathProfile.style;
  return hostPathFromNative(placement.homeDirectory).root.kind === 'posix' ? 'posix' : 'win32';
}
