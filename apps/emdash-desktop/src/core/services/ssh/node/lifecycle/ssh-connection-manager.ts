import { EventEmitter } from 'node:events';
import { waitWithSignal } from '@emdash/shared/scheduling';
import type { ConnectionState, SshConnectionEvent, SshHealthState } from '@core/primitives/ssh/api';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type {
  SshConnectionManager as SshConnectionManagerContract,
  SshConnectionManagerEvent,
} from '@core/primitives/ssh/api/node/ssh-connection-manager';
import type { SshConnectResult, OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { SshInteraction, connectionDeadline } from '../openssh/interaction';
import { connectOpenSsh, type SshSession } from '../openssh/session';
import { SshClientProxy } from './ssh-client-proxy';

export interface SshConnectionManagerDeps {
  connectSession?: (
    config: OpenSshConfig,
    options: { signal: AbortSignal; interaction: SshInteraction }
  ) => Promise<SshSession>;
  publishEvent?: (event: SshConnectionEvent) => void;
  log?: {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  };
}
type PhysicalConnection = {
  proxy: SshClientProxy;
  ephemeral: boolean;
  established: boolean;
  session?: SshSession;
  pending?: Promise<SshClientProxy>;
  controller?: AbortController;
};

/** Owns physical generations only. The host supervisor is the sole owner of reconnection policy. */
export class SshConnectionManager extends EventEmitter implements SshConnectionManagerContract {
  private readonly connections = new Map<string, PhysicalConnection>();
  private readonly closing = new Set<Promise<void>>();
  constructor(private readonly deps: SshConnectionManagerDeps = {}) {
    super();
  }

  async createConnection(
    id: string,
    resolve: () => Promise<SshConnectResult>,
    options: { ephemeral?: boolean; signal?: AbortSignal } = {}
  ): Promise<SshClientProxy> {
    options.signal?.throwIfAborted();
    let entry = this.connections.get(id);
    if (!entry) {
      entry = { proxy: new SshClientProxy(id), ephemeral: !!options.ephemeral, established: false };
      this.connections.set(id, entry);
    }
    if (entry.proxy.isConnected) return entry.proxy;
    if (entry.pending) return entry.pending;
    const physical = entry;
    const controller = new AbortController();
    physical.controller = controller;
    const abort = () => {
      if (physical.controller === controller) this.resetConnection(id);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    const pending = this.establish(id, physical, controller, resolve);
    physical.pending = pending;
    try {
      this.publish(
        id,
        { type: 'connecting', connectionId: id },
        { type: 'connecting', connectionId: id }
      );
      return await pending;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (physical.pending === pending) physical.pending = undefined;
    }
  }

  getProxy(id: string) {
    return this.connections.get(id)?.proxy;
  }
  isConnected(id: string): boolean {
    return this.getProxy(id)?.isConnected ?? false;
  }
  getConnectionIds(): string[] {
    return [...this.connections].filter(([, entry]) => !entry.ephemeral).map(([id]) => id);
  }
  getConnectionState(id: string): ConnectionState {
    const entry = this.connections.get(id);
    return entry?.proxy.isConnected ? 'connected' : entry?.pending ? 'connecting' : 'disconnected';
  }
  getAllConnectionStates(): Record<string, ConnectionState> {
    return Object.fromEntries(
      this.getConnectionIds().map((id) => [id, this.getConnectionState(id)])
    );
  }
  getAllHealthStates(): Record<string, SshHealthState> {
    return {};
  }

  resetConnection(id: string): void {
    const entry = this.connections.get(id);
    if (!entry) return;
    const connected = entry.proxy.isConnected;
    const session = entry.session;
    const controller = entry.controller;
    entry.controller = undefined;
    entry.session = undefined;
    entry.pending = undefined;
    entry.proxy.invalidate();
    controller?.abort(new Error('SSH connection closed'));
    if (session) this.retire(session);
    if (connected)
      this.publish(
        id,
        { type: 'disconnected', connectionId: id },
        { type: 'disconnected', connectionId: id }
      );
  }
  async dropConnection(id: string): Promise<void> {
    this.resetConnection(id);
    this.connections.delete(id);
    await Promise.all(this.closing);
  }
  async disconnectAll(): Promise<void> {
    for (const id of this.connections.keys()) this.resetConnection(id);
    this.connections.clear();
    await Promise.all(this.closing);
  }

  private async establish(
    id: string,
    entry: PhysicalConnection,
    controller: AbortController,
    resolve: () => Promise<SshConnectResult>
  ): Promise<SshClientProxy> {
    const signal = controller.signal;
    const current = () =>
      this.connections.get(id) === entry && entry.controller === controller && !signal.aborted;
    let disposeDeadline: (() => void) | undefined;
    try {
      const resolved = await waitWithSignal(Promise.resolve().then(resolve), signal);
      signal.throwIfAborted();
      const interaction = new SshInteraction();
      disposeDeadline = connectionDeadline(
        resolved.config.readyTimeout,
        () => controller.abort(new SshConnectionFailure('timeout', 'SSH connection timed out')),
        interaction
      );
      const connecting = (this.deps.connectSession ?? connectOpenSsh)(resolved.config, {
        signal,
        interaction,
      });
      // Even a connector that finishes after cancellation cannot leak a live session.
      void connecting.then(
        (session) => {
          if (!current()) this.retire(session);
        },
        () => {}
      );
      const session = await waitWithSignal(connecting, signal);
      signal.throwIfAborted();
      entry.session = session;
      entry.proxy.update(session);
      const type = entry.established ? 'reconnected' : 'connected';
      entry.established = true;
      void session.closed.then(() => {
        if (current() && entry.session === session) this.resetConnection(id);
      });
      this.publish(id, { type, connectionId: id, proxy: entry.proxy }, { type, connectionId: id });
      return entry.proxy;
    } catch (error) {
      const failure = classifyError(error);
      if (entry.controller === controller) {
        entry.controller = undefined;
        entry.proxy.invalidate();
        controller.abort(failure);
        this.publish(
          id,
          { type: 'error', connectionId: id, error: failure },
          { type: 'error', connectionId: id, errorMessage: failure.message }
        );
      }
      throw failure;
    } finally {
      disposeDeadline?.();
    }
  }
  private retire(session: SshSession): void {
    const closing = session
      .close()
      .catch((error: unknown) =>
        this.deps.log?.warn('Could not close SSH session', { error: String(error) })
      );
    this.closing.add(closing);
    void closing.finally(() => this.closing.delete(closing));
  }
  private publish(
    id: string,
    event: SshConnectionManagerEvent,
    published: SshConnectionEvent
  ): void {
    if (this.connections.get(id)?.ephemeral) return;
    this.emit('connection-event', event);
    this.deps.publishEvent?.(published);
  }
}

function classifyError(error: unknown): SshConnectionFailure {
  if (error instanceof SshConnectionFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  const kind = /host key|host fingerprint|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(message)
    ? 'host-key'
    : /authentication|permission denied|passphrase|password/i.test(message)
      ? 'authentication'
      : /timeout|timed out/i.test(message)
        ? 'timeout'
        : /not found|bad configuration|invalid ssh/i.test(message)
          ? 'configuration'
          : 'transport';
  return new SshConnectionFailure(kind, message, { cause: error });
}
