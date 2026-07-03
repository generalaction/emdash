import type { Client, InitializeResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import type { AcpAgentApi, IAcpBehavior } from '../agents/plugins/capabilities/acp';
import { type Logger, noopLogger } from '../lib';
import type { InitializeFailedError, SpawnFailedError } from './errors';
import { acpErr } from './errors';
import { decodeSessionUpdate } from './reducer/decode';
import type { NormalizedEvent } from './reducer/normalized-event';
import type { AcpProcessHandle, AcpProcessHost } from './transport';

/** Live connection to one spawned agent process. */
export interface AcpAgentConnection {
  handle: AcpProcessHandle;
  agent: AcpAgentApi;
  normalize: (raw: SessionUpdate) => NormalizedEvent;
  /** Resolves with agent capabilities once initialize completes, or an error if it fails. */
  initialized: Promise<Result<{ supportsLoadSession: boolean }, InitializeFailedError>>;
}

/**
 * Spin up an agent process and return a live connection to it.
 * Returns an Err if the spawn or connection phase fails; initialize failures
 * are reported through `AcpAgentConnection.initialized` so the process can be
 * registered before the handshake completes.
 */
export async function createAcpAgentConnection(
  deps: {
    host: AcpProcessHost;
    behavior: IAcpBehavior;
    logger?: Logger;
  },
  args: {
    providerId: string;
    cwd: string;
    /** Factory called once; the runtime passes its buildClientHandler result here. */
    buildClient: (agent: AcpAgentApi) => Client;
    /** Called when the process exits unexpectedly or initialize fails. */
    onClosed: () => void;
  }
): Promise<Result<AcpAgentConnection, SpawnFailedError>> {
  const { providerId, cwd, buildClient, onClosed } = args;
  const { host, behavior, logger = noopLogger } = deps;

  let handle: AcpProcessHandle;
  try {
    const { cli, agentEnv } = await host.resolveSpawnContext(providerId);
    const {
      command,
      args: spawnArgs,
      env: envOverlay,
    } = behavior.buildSpawn({ cwd, env: agentEnv, cli });

    handle = await host.spawn({
      command,
      args: spawnArgs,
      env: { ...agentEnv, ...envOverlay },
      cwd,
    });
  } catch (e) {
    return acpErr.spawnFailed(toSerializedError(e));
  }

  if (handle.stderr) {
    handle.stderr.on('data', (data: Buffer) => {
      logger.debug('createAcpAgentConnection: agent stderr', { text: data.toString().trim() });
    });
  }

  handle.onExit(() => onClosed());
  handle.onError((err) => {
    logger.error('createAcpAgentConnection: agent process error', { error: err.message });
    onClosed();
  });

  const connection = behavior.connect({ stdin: handle.stdin, stdout: handle.stdout }, buildClient);

  const normalize = (raw: SessionUpdate): NormalizedEvent => {
    const base = decodeSessionUpdate(raw);
    return behavior.enrich ? behavior.enrich(base, raw) : base;
  };

  const supportsTerminal = typeof host.spawnTerminal === 'function';
  const initialized: AcpAgentConnection['initialized'] = connection
    .initialize({
      protocolVersion: 1,
      clientInfo: { name: 'emdash', version: '1' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: supportsTerminal,
      },
    })
    .then((resp: InitializeResponse) => {
      const supportsLoadSession = resp.agentCapabilities?.loadSession === true;
      logger.debug('createAcpAgentConnection: initialized', { supportsLoadSession });
      return ok({ supportsLoadSession });
    })
    .catch((e: unknown) => {
      logger.error('createAcpAgentConnection: initialize failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      onClosed();
      return acpErr.initializeFailed(toSerializedError(e));
    });

  return ok({ handle, agent: connection, normalize, initialized });
}
