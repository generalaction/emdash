import { workspaceWireContract, type WireInitializeResult } from '@emdash/core/workspace-server';
import { createResourceCache, type ResourceCache, type Scope } from '@emdash/shared/concurrency';
import { retrySchedules, type Clock, type RetrySchedule } from '@emdash/shared/scheduling';
import {
  client as createClient,
  connect,
  reconnectingTransport,
  type Connection,
  type ContractClient,
  type ReconnectingTransport,
  type WireTransport,
} from '@emdash/wire';
import type { WorkspaceServerSshPort } from '../ports';
import { workspaceServerTargetKey, type WorkspaceServerTarget } from '../targets';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';
import { initializeWorkspaceServerTransport, WorkspaceServerProtocolError } from './protocol';
import { openSshWorkspaceServerTransport } from './ssh-streamlocal-transport';

export type WorkspaceServerConnection = {
  target: WorkspaceServerTarget;
  client: ContractClient<typeof workspaceWireContract>;
  connection: Connection;
  ready(): Promise<WireInitializeResult>;
  currentHandshake(): WireInitializeResult | undefined;
};

export interface WorkspaceServerClientSource extends ResourceCache<
  WorkspaceServerTarget,
  WorkspaceServerConnection
> {
  invalidateConnection(connectionId: string): Promise<void>;
  onTerminalError(listener: (error: unknown, target: WorkspaceServerTarget) => void): () => void;
}

export type CreateWorkspaceServerClientSourceOptions = {
  scope?: Scope;
  clock?: Clock;
  idleTtlMs?: number;
  retrySchedule?: RetrySchedule;
  protocolVersion?: string;
  ssh?: WorkspaceServerSshPort;
  openTransport?: (target: WorkspaceServerTarget) => Promise<WireTransport>;
};

export type OpenWorkspaceServerTransportOptions = {
  ssh?: WorkspaceServerSshPort;
};

export class WorkspaceServerConfigurationError extends Error {
  readonly name = 'WorkspaceServerConfigurationError';
}

export const workspaceServerReconnectSchedule = retrySchedules.sequence([
  500, 1_000, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 30_000,
]);

export function createWorkspaceServerClientSource(
  options: CreateWorkspaceServerClientSourceOptions = {}
): WorkspaceServerClientSource {
  const targetsByKey = new Map<string, WorkspaceServerTarget>();
  const targetKeysByConnection = new Map<string, Set<string>>();
  const terminalErrorListeners = new Set<(error: unknown, target: WorkspaceServerTarget) => void>();
  const cache = createResourceCache<WorkspaceServerTarget, WorkspaceServerConnection>({
    key: workspaceServerTargetKey,
    scope: options.scope,
    label: 'workspace-server-clients',
    clock: options.clock,
    idleTtlMs: options.idleTtlMs ?? 30_000,
    create: (target, scope) => {
      trackTarget(target, scope);
      return createWorkspaceServerConnection(
        target,
        scope,
        options,
        (error) => {
          if (scope.disposed) return;
          notifyTerminalError(error, target);
          void cache.invalidate(target).catch(() => {});
        },
        (error) => notifyTerminalError(error, target)
      );
    },
  });

  return {
    acquire: (target) => cache.acquire(target),
    peek: (target) => cache.peek(target),
    invalidate: (target) => cache.invalidate(target),
    async invalidateConnection(connectionId) {
      const targetKeys = [...(targetKeysByConnection.get(connectionId) ?? [])];
      const targets = targetKeys.flatMap((key) => {
        const target = targetsByKey.get(key);
        return target ? [target] : [];
      });
      await Promise.all(targets.map((target) => cache.invalidate(target)));
    },
    onTerminalError(listener) {
      terminalErrorListeners.add(listener);
      return () => {
        terminalErrorListeners.delete(listener);
      };
    },
    async dispose() {
      await cache.dispose();
      targetsByKey.clear();
      targetKeysByConnection.clear();
      terminalErrorListeners.clear();
    },
  };

  function trackTarget(target: WorkspaceServerTarget, scope: Scope): void {
    if (target.kind !== 'ssh') return;
    const key = workspaceServerTargetKey(target);
    targetsByKey.set(key, target);
    const targetKeys = targetKeysByConnection.get(target.sshConnectionId) ?? new Set<string>();
    targetKeys.add(key);
    targetKeysByConnection.set(target.sshConnectionId, targetKeys);
    scope.add(() => pruneTarget(target));
  }

  function pruneTarget(target: WorkspaceServerTarget): void {
    if (target.kind !== 'ssh') return;
    const key = workspaceServerTargetKey(target);
    targetsByKey.delete(key);
    const targetKeys = targetKeysByConnection.get(target.sshConnectionId);
    targetKeys?.delete(key);
    if (targetKeys?.size === 0) targetKeysByConnection.delete(target.sshConnectionId);
  }

  function notifyTerminalError(error: unknown, target: WorkspaceServerTarget): void {
    for (const listener of terminalErrorListeners) {
      try {
        listener(error, target);
      } catch {
        // Error reporting must not interfere with connection teardown.
      }
    }
  }
}

async function createWorkspaceServerConnection(
  target: WorkspaceServerTarget,
  scope: Scope,
  options: CreateWorkspaceServerClientSourceOptions,
  onTerminalError: (error: unknown) => void,
  onInitialError: (error: unknown) => void
): Promise<WorkspaceServerConnection> {
  let handshake: WireInitializeResult | undefined;
  const openTransport =
    options.openTransport ??
    ((nextTarget: WorkspaceServerTarget) => openWorkspaceServerTransport(nextTarget, options));
  const transport = reconnectingTransport(
    async () => {
      const candidate = await openTransport(target);
      const nextHandshake = await initializeWorkspaceServerTransport(
        candidate,
        options.protocolVersion
      );
      handshake = nextHandshake;
      return candidate;
    },
    {
      clock: options.clock,
      retrySchedule: options.retrySchedule ?? workspaceServerReconnectSchedule,
      shouldRetry: (error) =>
        !(error instanceof WorkspaceServerProtocolError) &&
        !(error instanceof WorkspaceServerConfigurationError),
    }
  );
  scope.add(() => transport.close());

  const connection = connect(transport);
  scope.add(() => connection.dispose());
  scope.add(
    connection.onDisconnect(() => {
      void transport.ready().catch(onTerminalError);
    })
  );
  const client = createClient(workspaceWireContract, connection);

  try {
    await transport.ready();
  } catch (error) {
    onInitialError(error);
    throw error;
  }
  requireHandshake(handshake);

  return {
    target,
    client,
    connection,
    ready: () => readyHandshake(transport, () => handshake),
    currentHandshake: () => handshake,
  };
}

export function openWorkspaceServerTransport(
  target: WorkspaceServerTarget,
  options: OpenWorkspaceServerTransportOptions = {}
): Promise<WireTransport> {
  switch (target.kind) {
    case 'local-socket':
      return openLocalWorkspaceServerTransport(target);
    case 'ssh':
      if (!options.ssh) {
        throw new WorkspaceServerConfigurationError(
          'An SSH service is required for an SSH workspace-server target'
        );
      }
      return openSshWorkspaceServerTransport(target, options.ssh);
  }
}

async function readyHandshake(
  transport: ReconnectingTransport,
  current: () => WireInitializeResult | undefined
): Promise<WireInitializeResult> {
  await transport.ready();
  const handshake = current();
  requireHandshake(handshake);
  return handshake;
}

function requireHandshake(
  handshake: WireInitializeResult | undefined
): asserts handshake is WireInitializeResult {
  if (!handshake) {
    throw new Error('Workspace server transport became ready without an initialize response');
  }
}
