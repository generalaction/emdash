import type { IGitWorktree } from '@emdash/core/git';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { LifecycleScriptService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly fs: FileSystemProvider;
  readonly gitWorktree: IGitWorktree;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: LifecycleScriptService;
  readonly gitRepository: GitRepositoryService;
  readonly gitRepositoryFetchService: GitRepositoryFetchService;
  dispose?(): void | Promise<void>;
}
