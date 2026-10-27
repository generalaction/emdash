import type { HostRef } from '@agent/core/primitives/host/api';
import type {
  TuiAgentsRuntimeClient,
  WorkspaceRegistryRuntimeClient,
} from '@core/services/runtime-broker/api/clients';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

export interface Workspace {
  readonly id: string;
  readonly host: HostRef;
  readonly path: string;
  readonly files: FilesClientScope;
  readonly tuiAgents: TuiAgentsRuntimeClient;
  readonly workspaceRegistry: WorkspaceRegistryRuntimeClient;
  dispose?(): void | Promise<void>;
}
