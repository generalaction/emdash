import type { HostRef } from '@emdash/core/primitives/host/api';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { TuiAgentsRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

export interface Workspace {
  readonly id: string;
  readonly host: HostRef;
  readonly path: string;
  readonly configPath: string;
  readonly files: FilesClientScope;
  readonly settings: ProjectSettingsProvider;
  readonly tuiAgents: TuiAgentsRuntimeClient;
  dispose?(): void | Promise<void>;
}
