import { dirname, join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import type { HostDependencyResolverContract } from '@emdash/core/services/host-dependencies/api';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { ContractClient } from '@emdash/wire/api';
import type { WireWorkerHost } from '@emdash/wire/worker';
import { daemonPaths } from '../daemon/paths';
import { workspaceWorkerPath } from '../worker-manifest';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

const SESSION_IDLE_MS = 60 * 60_000;

export function defineAcpWorkspaceRuntimeWorker(
  host: WireWorkerHost,
  options: {
    socketPath?: string;
    hostDependencies: ContractClient<HostDependencyResolverContract>;
  }
) {
  const paths = daemonPaths(options.socketPath);
  return host.create(createAcpComponent({ pluginRegistry }), {
    name: 'acp',
    executable: workspaceWorkerPath('acp'),
    env: process.env,
    dependencies: {
      hostDependencies: options.hostDependencies,
    },
    config: {
      attachmentsDir: join(dirname(paths.socketPath), 'acp-attachments'),
      lifecycle: {
        session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
        connectionIdleTtlMs: 120_000,
      },
    },
  });
}
