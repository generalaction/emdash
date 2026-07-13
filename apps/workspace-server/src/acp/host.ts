import { dirname, join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { ContractClient } from '@emdash/wire/api';
import type { WireWorkerHost } from '@emdash/wire/worker';
import { daemonPaths } from '../daemon/paths';
import { workspaceWorkerPath } from '../worker-manifest';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export function defineAcpWorkspaceRuntimeWorker(
  host: WireWorkerHost,
  options: {
    socketPath?: string;
  }
) {
  const paths = daemonPaths(options.socketPath);
  return host.create(createAcpComponent({ pluginRegistry }), {
    name: 'acp',
    executable: workspaceWorkerPath('acp'),
    env: process.env,
    dependencies: {},
    config: {
      attachmentsDir: join(dirname(paths.socketPath), 'acp-attachments'),
    },
  });
}
