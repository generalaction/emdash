import type { HostRef } from '@emdash/core/primitives/host/api';
import type { FilesClientScope } from '@main/core/files/runtime-client';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';

export interface Workspace {
  readonly id: string;
  readonly host: HostRef;
  readonly path: string;
  readonly configPath: string;
  readonly files: FilesClientScope;
  readonly settings: ProjectSettingsProvider;
  dispose?(): void | Promise<void>;
}
