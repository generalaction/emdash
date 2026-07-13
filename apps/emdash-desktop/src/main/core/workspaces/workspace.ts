import type { FilesClientScope } from '@main/core/files/runtime-client';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { LifecycleScriptService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly configPath: string;
  readonly files: FilesClientScope;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: LifecycleScriptService;
  dispose?(): void | Promise<void>;
}
