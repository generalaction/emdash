import type { Client, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  InitializeFailedError,
  NormalizedEvent,
  SpawnFailedError,
} from '@emdash/core/acp';
import { acpErr, decodeSessionUpdate } from '@emdash/core/acp';
import type { AcpAgentApi, AgentHostAcpSpawn, IAcpBehavior } from '@emdash/core/agents/plugins';
import type { Result } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import type { Scope } from '@emdash/wire/util';

type AcpAgentProcessHost = Pick<AcpProcessHost, 'spawn' | 'spawnTerminal'>;

export type AcpConnectionError = SpawnFailedError | InitializeFailedError;
export type AcpSessionUpdateNormalizer = (raw: SessionUpdate) => NormalizedEvent;

/** Live connection to one spawned agent process. */
export interface AcpAgentConnection {
  agent: AcpAgentApi;
  normalize: AcpSessionUpdateNormalizer;
  supportsLoadSession: boolean;
}

/**
 * Spin up an agent process, initialize it, and return a ready connection.
 * Setup failures are reported as Result errors; `onClosed` is reserved for
 * unexpected exits after the connection is ready.
 */
export async function createAcpAgentConnection(
  deps: {
    host: AcpAgentProcessHost;
    behavior: IAcpBehavior;
    logger?: Logger;
  },
  args: {
    providerId: string;
    spawn: AgentHostAcpSpawn;
    scope: Scope;
    /** Factory called once; the runtime passes its buildAgentClient result here. */
    buildClient: (agent: AcpAgentApi, normalize: AcpSessionUpdateNormalizer) => Client;
    /** Called when a ready process exits unexpectedly. */
    onClosed: (exitCode: number | null) => void;
  }
): Promise<Result<AcpAgentConnection, AcpConnectionError>> {
  const { providerId, spawn, scope, buildClient, onClosed } = args;
  const { host, behavior, logger = noopLogger } = deps;
  const connectionScope = scope.child(`acp-connection:${providerId}`);

  let handle: AcpProcessHandle;
  try {
    handle = await host.spawn({
      command: spawn.command,
      args: spawn.args,
      env: spawn.env,
      cwd: spawn.cwd,
    });
  } catch (e) {
    await connectionScope.dispose();
    return acpErr.spawnFailed(toSerializedError(e));
  }

  if (handle.stderr) {
    const onStderr = (data: Buffer): void => {
      logger.debug('createAcpAgentConnection: agent stderr', { text: data.toString().trim() });
    };
    handle.stderr.on('data', onStderr);
    connectionScope.add(() => {
      handle.stderr?.off?.('data', onStderr);
      handle.stderr?.removeListener?.('data', onStderr);
    });
  }

  let ready = false;
  let closing = false;
  let closedNotified = false;
  let rejectBeforeReady: (error: Error) => void = () => {};
  const beforeReadyClosed = new Promise<never>((_resolve, reject) => {
    rejectBeforeReady = reject;
  });

  connectionScope.add(() => {
    closing = true;
    try {
      handle.kill('SIGTERM');
    } catch {
      // Ignore teardown errors; process may have already exited.
    }
  });

  handle.onExit((exitCode) => {
    if (!ready) {
      rejectBeforeReady(
        new Error(
          `ACP agent process exited before initialize completed (code ${exitCode ?? 'null'})`
        )
      );
      return;
    }
    if (closing) return;
    notifyClosed(exitCode);
  });
  handle.onError((err) => {
    logger.error('createAcpAgentConnection: agent process error', { error: err.message });
    if (!ready) {
      rejectBeforeReady(err);
      return;
    }
    if (closing) return;
    notifyClosed(handle.exitCode);
  });

  const normalize = (raw: SessionUpdate): NormalizedEvent => {
    const base = decodeSessionUpdate(raw);
    return behavior.enrich ? behavior.enrich(base, raw) : base;
  };

  let connection: AcpAgentApi;
  try {
    connection = behavior.connect({ stdin: handle.stdin, stdout: handle.stdout }, (agent) =>
      buildClient(agent, normalize)
    );
  } catch (e) {
    await connectionScope.dispose();
    return acpErr.initializeFailed(toSerializedError(e));
  }

  try {
    const supportsTerminal = typeof host.spawnTerminal === 'function';
    const initialized = await Promise.race([
      connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'emdash', version: '1' },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: supportsTerminal,
        },
      }),
      beforeReadyClosed,
    ]);
    const supportsLoadSession = initialized.agentCapabilities?.loadSession === true;
    logger.debug('createAcpAgentConnection: initialized', { supportsLoadSession });
    ready = true;
    return ok({ agent: connection, normalize, supportsLoadSession });
  } catch (e) {
    logger.error('createAcpAgentConnection: initialize failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    await connectionScope.dispose();
    return acpErr.initializeFailed(toSerializedError(e));
  }

  function notifyClosed(exitCode: number | null): void {
    if (closedNotified) return;
    closedNotified = true;
    onClosed(exitCode);
  }
}
