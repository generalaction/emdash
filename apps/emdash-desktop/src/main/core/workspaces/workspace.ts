import type { ScopedFileSystem } from '@main/core/files/scoped-file-system';
import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import type { RuntimeGitCheckout } from '@main/core/git/runtime-git';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { LifecycleScriptService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly configPath: string;
  readonly fileSystem: ScopedFileSystem;
  readonly gitCheckout: RuntimeGitCheckout;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: LifecycleScriptService;
  readonly gitRepository: GitRepositoryService;
  readonly gitRepositoryFetchService: GitRepositoryFetchService;
  dispose?(): void | Promise<void>;
}
