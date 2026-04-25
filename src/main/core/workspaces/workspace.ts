import type { FileSystemProvider } from '@main/core/fs/types';
import type { WorkspaceGitProvider } from '@main/core/git/workspace-git-provider';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/schema';
import type { WorkspaceLifecycleService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly fs: FileSystemProvider;
  readonly git: WorkspaceGitProvider;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: WorkspaceLifecycleService;
}
