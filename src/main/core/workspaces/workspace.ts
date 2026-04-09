import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitProvider } from '@main/core/git/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/schema';
import type { WorkspaceLifecycleService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly fs: FileSystemProvider;
  readonly git: GitProvider;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: WorkspaceLifecycleService;
}
