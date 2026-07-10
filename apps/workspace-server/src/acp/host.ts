import { dirname, join } from 'node:path';
import { acpApiContract, type AcpApiContract } from '@emdash/core/acp';
import { type ContractClient } from '@emdash/wire/api';
import { spawnWorker, type WorkerHandle } from '@emdash/wire/worker';
import { daemonPaths } from '../daemon/paths';
import { workspaceWorkerPath } from '../worker-manifest';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export async function spawnAcpWorkspaceRuntimeProcess(options: {
  socketPath?: string;
}): Promise<WorkerHandle<AcpApiContract>> {
  const paths = daemonPaths(options.socketPath);
  return spawnWorker({
    name: 'acp',
    contract: acpApiContract,
    entry: workspaceWorkerPath('acp'),
    env: {
      ...process.env,
      EMDASH_ACP_ATTACHMENTS_DIR: join(dirname(paths.socketPath), 'acp-attachments'),
    },
  });
}
