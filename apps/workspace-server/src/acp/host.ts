import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acpApiContract, type AcpApiContract } from '@emdash/core/acp';
import { log } from '@emdash/shared/logger';
import { type ContractClient } from '@emdash/wire/api';
import { type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import {
  forwardRuntimeLogs,
  spawnRuntime,
  type RuntimeHandle,
} from '@emdash/wire/util/process-runtime';
import { daemonPaths } from '../daemon/paths';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export async function spawnAcpWorkspaceRuntimeProcess(options: {
  socketPath?: string;
}): Promise<RuntimeHandle<AcpApiContract>> {
  const paths = daemonPaths(options.socketPath);
  const entry = await resolveRuntimeEntry();
  log.info('ACP runtime child process entry resolved', { entry });
  const handle = await spawnRuntime({
    host: childProcessHost(),
    contract: acpApiContract,
    spec: {
      entry,
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(dirname(paths.socketPath), 'acp-attachments'),
      },
      supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
    },
    onProcess: attachAcpRuntimeLogging,
  });

  handle.onRestarted(() => {
    log.info('ACP runtime child process restarted');
  });

  return handle;
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

function attachAcpRuntimeLogging(process: ManagedProcess): void {
  forwardRuntimeLogs(process, log, { source: 'acp-runtime' });
  process.onExit((exit) => {
    log.warn('ACP runtime child process exited', exit);
  });
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
