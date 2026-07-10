import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acpApiContract, acpHostContract, type AcpApiContract } from '@emdash/core/acp';
import { log } from '@emdash/shared/logger';
import {
  createController,
  serve,
  withValidation,
  type ContractClient,
  type ValidatePolicy,
} from '@emdash/wire/api';
import { processTransport, type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { forwardRuntimeLogs, spawnRuntime } from '@emdash/wire/util/process-runtime';
import { daemonPaths } from '../daemon/paths';

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export async function spawnAcpWorkspaceRuntimeProcess(options: { socketPath?: string }): Promise<{
  client: WorkspaceAcpRuntimeClient;
  dispose(): Promise<void>;
}> {
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

  const transport = processTransport(handle.process);
  const controller = withValidation(
    acpHostContract,
    createController(acpHostContract, {
      persistSessionId: ({ conversationId, sessionId }) => {
        log.debug('ACP runtime returned session id for client persistence', {
          conversationId,
          sessionId,
        });
      },
    }),
    workspaceServerWireValidationPolicy()
  );
  const disposeServer = serve(transport, controller);
  handle.onRestarted(() => {
    log.info('ACP runtime child process restarted');
  });

  return {
    client: handle.client,
    async dispose() {
      disposeServer();
      transport.close?.();
      await handle.dispose();
    },
  };
}

function workspaceServerWireValidationPolicy(): ValidatePolicy {
  return process.env.NODE_ENV === 'production' ? 'inputs' : 'full';
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
