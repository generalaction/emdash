import { EventEmitter } from 'node:events';
import { waitWithSignal } from '@emdash/shared/scheduling';
import ssh2, { type Client } from 'ssh2';
import type { ConnectionState, SshConnectionEvent, SshHealthState } from '@core/primitives/ssh/api';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type {
  SshConnectionManager as SshConnectionManagerContract,
  SshConnectionManagerEvent,
} from '@core/primitives/ssh/api/node/ssh-connection-manager';
import type { SshConnectResult } from '../connect/resolve-ssh-connect-config';
import { SshClientProxy } from './ssh-client-proxy';

export class SshAuthError extends SshConnectionFailure {
  readonly name = 'SshAuthError';
  constructor(message: string) {
    super('authentication', message);
  }
}
export class SshTimeoutError extends SshConnectionFailure {
  readonly name = 'SshTimeoutError';
  constructor(message: string) {
    super('timeout', message);
  }
}
export class SshConnectionError extends SshConnectionFailure {
  readonly name = 'SshConnectionError';
  constructor(message: string) {
    super('transport', message);
  }
}

export interface SshConnectionManagerDeps {
  createClient?: () => Client;
  publishEvent?: (event: SshConnectionEvent) => void;
  log?: {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  };
}
type PhysicalConnection = {
  proxy: SshClientProxy;
  generation: number;
  ephemeral: boolean;
  established: boolean;
  client?: Client;
  pending?: Promise<SshClientProxy>;
  controller?: AbortController;
  cleanup?: () => void;
};

/** Physical SSH adapter. Host supervisors alone own reconnect policy and intent. */
export class SshConnectionManager extends EventEmitter implements SshConnectionManagerContract {
  private readonly connections = new Map<string, PhysicalConnection>();

  constructor(private readonly deps: SshConnectionManagerDeps = {}) {
    super();
  }

  async createConnection(
    id: string,
    resolve: () => Promise<SshConnectResult>,
    options: { ephemeral?: boolean; signal?: AbortSignal } = {}
  ): Promise<SshClientProxy> {
    if (options.signal?.aborted) throw options.signal.reason;
    let entry = this.connections.get(id);
    if (!entry) {
      entry = {
        proxy: new SshClientProxy(id),
        generation: 0,
        ephemeral: !!options.ephemeral,
        established: false,
      };
      this.connections.set(id, entry);
    }
    if (entry.proxy.isConnected) return entry.proxy;
    if (entry.pending) return entry.pending;
    const physical = entry;
    const generation = ++physical.generation;
    const controller = new AbortController();
    physical.controller = controller;
    const abort = () => {
      if (this.isCurrent(id, physical, generation)) this.resetConnection(id);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    this.publish(
      id,
      { type: 'connecting', connectionId: id },
      { type: 'connecting', connectionId: id }
    );
    const pending = this.establish(id, physical, generation, resolve, controller.signal);
    physical.pending = pending;
    try {
      return await pending;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (physical.pending === pending) physical.pending = undefined;
    }
  }

  getProxy(id: string): SshClientProxy | undefined {
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
    if (entry?.proxy.isConnected) return 'connected';
    return entry?.pending ? 'connecting' : 'disconnected';
  }
  getAllConnectionStates(): Record<string, ConnectionState> {
    return Object.fromEntries(
      this.getConnectionIds().map((id) => [id, this.getConnectionState(id)])
    );
  }
  getAllHealthStates(): Record<string, SshHealthState> {
    return {};
  }

  /** Retire a physical generation immediately while preserving its logical proxy. */
  resetConnection(id: string): void {
    const entry = this.connections.get(id);
    if (!entry) return;
    const wasConnected = entry.proxy.isConnected;
    entry.generation += 1;
    const controller = entry.controller;
    const client = entry.client;
    entry.controller = undefined;
    entry.client = undefined;
    entry.pending = undefined;
    entry.proxy.invalidate();
    controller?.abort(new SshConnectionError('SSH connection closed before ready'));
    client?.destroy();
    entry.cleanup?.();
    entry.cleanup = undefined;
    if (wasConnected)
      this.publish(
        id,
        { type: 'disconnected', connectionId: id },
        { type: 'disconnected', connectionId: id }
      );
  }

  async dropConnection(id: string): Promise<void> {
    this.resetConnection(id);
    this.connections.delete(id);
  }
  async disconnectAll(): Promise<void> {
    for (const id of this.connections.keys()) await this.dropConnection(id);
  }

  private async establish(
    id: string,
    entry: PhysicalConnection,
    generation: number,
    resolve: () => Promise<SshConnectResult>,
    signal: AbortSignal
  ): Promise<SshClientProxy> {
    const resolving = Promise.resolve().then(resolve);
    let resolved: SshConnectResult;
    try {
      resolved = await waitWithSignal(resolving, signal);
    } catch (error) {
      if (signal.aborted)
        void resolving.then(
          (late) => late.cleanup(),
          () => {}
        );
      throw error;
    }
    if (!this.isCurrent(id, entry, generation) || signal.aborted) {
      resolved.cleanup();
      throw new SshConnectionError('SSH connection was disconnected before connecting');
    }
    const client = this.deps.createClient?.() ?? new ssh2.Client();
    entry.client = client;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (entry.cleanup === cleanup) entry.cleanup = undefined;
      resolved.cleanup();
    };
    entry.cleanup = cleanup;
    return new Promise<SshClientProxy>((resolveReady, reject) => {
      let ready = false;
      let settled = false;
      const current = () => this.isCurrent(id, entry, generation) && !signal.aborted;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolveReady(entry.proxy);
      };
      const lose = (error: Error) => {
        if (!current()) {
          cleanup();
          finish(error);
          return;
        }
        const wasReady = ready && entry.proxy.isConnected && entry.proxy.client === client;
        if (entry.client === client) entry.client = undefined;
        if (wasReady) entry.proxy.invalidate();
        cleanup();
        finish(error);
        if (wasReady)
          this.publish(
            id,
            { type: 'disconnected', connectionId: id },
            { type: 'disconnected', connectionId: id }
          );
      };
      const abort = () => {
        cleanup();
        finish(
          signal.reason instanceof Error
            ? signal.reason
            : new SshConnectionError('SSH establishment cancelled')
        );
      };
      const timeoutMs =
        resolved.config.readyTimeout && resolved.config.readyTimeout > 0
          ? resolved.config.readyTimeout
          : 20_000;
      const timer = setTimeout(() => {
        lose(new SshTimeoutError('SSH connection timed out'));
        client.destroy();
      }, timeoutMs);
      timer.unref?.();
      signal.addEventListener('abort', abort, { once: true });
      client.on('ready', () => {
        if (!current() || settled) {
          if (!ready) {
            cleanup();
            client.end();
            finish(new SshConnectionError('SSH connection closed before ready'));
          }
          return;
        }
        ready = true;
        const type = entry.established ? 'reconnected' : 'connected';
        entry.established = true;
        entry.proxy.update(client);
        finish();
        this.publish(
          id,
          { type, connectionId: id, proxy: entry.proxy },
          { type, connectionId: id }
        );
      });
      client.on('error', (error: Error) => {
        const failure = classifyError(error);
        const wasCurrent = current();
        lose(failure);
        if (wasCurrent)
          this.publish(
            id,
            { type: 'error', connectionId: id, error: failure },
            { type: 'error', connectionId: id, errorMessage: failure.message }
          );
        client.destroy();
      });
      client.on('close', () => lose(new SshConnectionError('SSH connection closed before ready')));
      try {
        client.connect(resolved.config);
      } catch (error) {
        lose(error instanceof Error ? error : new Error(String(error)));
        client.destroy();
      }
    });
  }

  private isCurrent(id: string, entry: PhysicalConnection, generation: number): boolean {
    return this.connections.get(id) === entry && entry.generation === generation;
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

function classifyError(error: Error): SshConnectionFailure {
  if (error instanceof SshConnectionFailure) return error;
  const message = error.message.toLowerCase();
  if (message.includes('host key') || message.includes('host fingerprint')) {
    return new SshConnectionFailure('host-key', error.message, { cause: error });
  }
  if (
    message.includes('authentication') ||
    message.includes('auth') ||
    message.includes('permission denied')
  )
    return new SshAuthError(error.message);
  if (message.includes('timeout') || message.includes('timed out'))
    return new SshTimeoutError(error.message);
  return new SshConnectionError(error.message);
}
