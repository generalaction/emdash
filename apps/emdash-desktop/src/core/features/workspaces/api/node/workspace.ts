import type { HostRef } from '@emdash/core/primitives/host/api';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

export interface Workspace {
  readonly id: string;
  readonly host: HostRef;
  readonly path: string;
  readonly configPath: string;
  readonly files: FilesClientScope;
  readonly settings: ProjectSettingsProvider;
  dispose?(): void | Promise<void>;
}
