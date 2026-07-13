import { dirname, join } from 'node:path';
import { acpApiContract, type AcpApiContract } from '@emdash/core/runtimes/acp/api';
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
  return host.define({
    name: 'acp',
    contract: acpApiContract,
    process: () => ({
      entry: workspaceWorkerPath('acp'),
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(dirname(paths.socketPath), 'acp-attachments'),
      },
    }),
  });
}
