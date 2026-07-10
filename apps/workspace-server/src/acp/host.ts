import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acpApiContract, type AcpApiContract } from '@emdash/core/acp';
import { type ContractClient } from '@emdash/wire/api';
import { spawnWorker, type WorkerHandle } from '@emdash/wire/worker';
import { daemonPaths } from '../daemon/paths';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export async function spawnAcpWorkspaceRuntimeProcess(options: {
  socketPath?: string;
}): Promise<WorkerHandle<AcpApiContract>> {
  const paths = daemonPaths(options.socketPath);
  const entry = await resolveRuntimeEntry();
  return spawnWorker({
    name: 'acp',
    contract: acpApiContract,
    entry,
    env: {
      ...process.env,
      EMDASH_ACP_ATTACHMENTS_DIR: join(dirname(paths.socketPath), 'acp-attachments'),
    },
  });
}

async function resolveRuntimeEntry(): Promise<string> {
  const baseDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(baseDir, 'acp-runtime.mjs'),
    join(baseDir, 'acp-runtime.js'),
    join(baseDir, 'runtime-entry.ts'),
  ];
  for (const candidate of candidates) {
    if (await canRead(candidate)) return candidate;
  }
  throw new Error(`ACP runtime child process entry is missing. Checked: ${candidates.join(', ')}`);
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
