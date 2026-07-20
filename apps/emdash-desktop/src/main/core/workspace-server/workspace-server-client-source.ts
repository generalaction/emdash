import {
  protocolUpgradeMessage,
  PROTOCOL_VERSION,
  workspaceWireContract,
  type WireInitializeResult,
  type WireProtocolIncompatible,
} from '@emdash/core/workspace-server';
import { createResourceCache, type ResourceCache, type Scope } from '@emdash/shared/concurrency';
import type { Clock, RetrySchedule } from '@emdash/shared/scheduling';
import {
  client as createClient,
  connect,
  reconnectingTransport,
  type Connection,
  type ContractClient,
  type ReconnectingTransport,
  type WireTransport,
} from '@emdash/wire';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';
import {
  openSshWorkspaceServerTransport,
  type WorkspaceServerSshConnectionManager,
} from './ssh-streamlocal-transport';

export type LocalWorkspaceServerTarget = {
  kind: 'local-socket';
  socketPath: string;
};

export type SshWorkspaceServerTarget = {
  kind: 'ssh';
  sshConnectionId: string;
  socketPath: string;
};

export type WorkspaceServerTarget = LocalWorkspaceServerTarget | SshWorkspaceServerTarget;

export type WorkspaceServerConnection = {
  target: WorkspaceServerTarget;
  client: ContractClient<typeof workspaceWireContract>;
  connection: Connection;
  ready(): Promise<WireInitializeResult>;
  currentHandshake(): WireInitializeResult | undefined;
};

export type WorkspaceServerClientSource = ResourceCache<
  WorkspaceServerTarget,
  WorkspaceServerConnection
>;

export type CreateWorkspaceServerClientSourceOptions = {
  scope?: Scope;
  clock?: Clock;
  idleTtlMs?: number;
  retrySchedule?: RetrySchedule;
  protocolVersion?: string;
  sshConnectionManager?: WorkspaceServerSshConnectionManager;
  openTransport?: (target: WorkspaceServerTarget) => Promise<WireTransport>;
  onTerminalError?: (error: unknown, target: WorkspaceServerTarget) => void;
};

export class WorkspaceServerProtocolError extends Error {
  readonly name = 'WorkspaceServerProtocolError';

  constructor(readonly details: WireProtocolIncompatible) {
    super(protocolUpgradeMessage(details.action));
  }
}

export class WorkspaceServerConfigurationError extends Error {
  readonly name = 'WorkspaceServerConfigurationError';
}

export function createWorkspaceServerClientSource(
  options: CreateWorkspaceServerClientSourceOptions = {}
): WorkspaceServerClientSource {
  const source = createResourceCache<WorkspaceServerTarget, WorkspaceServerConnection>({
    key: workspaceServerTargetKey,
    scope: options.scope,
    label: 'workspace-server-clients',
    clock: options.clock,
    idleTtlMs: options.idleTtlMs ?? 30_000,
    create: (target, scope) =>
      createWorkspaceServerConnection(target, scope, options, (error) => {
        if (scope.disposed) return;
        notifyTerminalError(options, error, target);
        void source.invalidate(target).catch(() => {});
      }),
  });
  return source;
}

export function workspaceServerTargetKey(target: WorkspaceServerTarget): string {
  switch (target.kind) {
    case 'local-socket':
      return `${target.kind}\0${target.socketPath}`;
    case 'ssh':
      return `${target.kind}\0${target.sshConnectionId}\0${target.socketPath}`;
  }
}

async function createWorkspaceServerConnection(
  target: WorkspaceServerTarget,
  scope: Scope,
  options: CreateWorkspaceServerClientSourceOptions,
  onTerminalError: (error: unknown) => void
): Promise<WorkspaceServerConnection> {
  let handshake: WireInitializeResult | undefined;
  const openTransport =
    options.openTransport ??
    ((nextTarget: WorkspaceServerTarget) => openDefaultTransport(nextTarget, options));
  const transport = reconnectingTransport(
    () =>
      openInitializedTransport(target, openTransport, options.protocolVersion, (nextHandshake) => {
        handshake = nextHandshake;
      }),
    {
      clock: options.clock,
      retrySchedule: options.retrySchedule,
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
    notifyTerminalError(options, error, target);
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

function openDefaultTransport(
  target: WorkspaceServerTarget,
  options: CreateWorkspaceServerClientSourceOptions
): Promise<WireTransport> {
  switch (target.kind) {
    case 'local-socket':
      return openLocalWorkspaceServerTransport(target);
    case 'ssh':
      if (!options.sshConnectionManager) {
        throw new WorkspaceServerConfigurationError(
          'An SSH connection manager is required for an SSH workspace-server target'
        );
      }
      return openSshWorkspaceServerTransport(target, options.sshConnectionManager);
  }
}

async function openInitializedTransport(
  target: WorkspaceServerTarget,
  openTransport: (target: WorkspaceServerTarget) => Promise<WireTransport>,
  protocolVersion: string = PROTOCOL_VERSION,
  onInitialized: (handshake: WireInitializeResult) => void
): Promise<WireTransport> {
  const candidate = await openTransport(target);
  const handshakeConnection = connect(candidate);
  const handshakeClient = createClient(workspaceWireContract, handshakeConnection);
  try {
    const initialized = await handshakeClient.initialize({ protocolVersion });
    if (!initialized.success) throw new WorkspaceServerProtocolError(initialized.error);
    onInitialized(initialized.data);
    return candidate;
  } catch (error) {
    candidate.close?.();
    throw error;
  } finally {
    handshakeConnection.dispose();
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

function notifyTerminalError(
  options: CreateWorkspaceServerClientSourceOptions,
  error: unknown,
  target: WorkspaceServerTarget
): void {
  try {
    options.onTerminalError?.(error, target);
  } catch {
    // Error reporting must not interfere with connection teardown.
  }
}
