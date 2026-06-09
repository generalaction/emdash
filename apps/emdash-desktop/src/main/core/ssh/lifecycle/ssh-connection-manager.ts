import { EventEmitter } from 'node:events';
import ssh2, { type Client, type ConnectConfig } from 'ssh2';
import type { SshConnectionRow } from '@main/db/schema';
import type { ConnectionState, SshHealthState } from '@shared/core/ssh/ssh';
import type { SshConnectionEvent } from '@shared/core/ssh/sshEvents';
import type { SshConnectResult } from '../connect/resolve-ssh-connect-config';
import { isSshChannelOpenFailure } from './ssh-channel-open-failure';
import { SshClientProxy } from './ssh-client-proxy';

const { Client: Ssh2Client } = ssh2;

// ─── Error classes ────────────────────────────────────────────────────────────

export class SshAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshAuthError';
  }
}

export class SshTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshTimeoutError';
  }
}

export class SshConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshConnectionError';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SshConnectionManagerEvent =
  | { type: 'connecting'; connectionId: string }
  | { type: 'connected'; connectionId: string; proxy: SshClientProxy }
  | { type: 'disconnected'; connectionId: string }
  | { type: 'reconnecting'; connectionId: string; attempt: number; delayMs: number }
  | { type: 'reconnected'; connectionId: string; proxy: SshClientProxy }
  | { type: 'reconnect-failed'; connectionId: string }
  | { type: 'error'; connectionId: string; error: Error };

/** Delays (ms) between successive reconnect attempts. Length = max attempts. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000];

interface ReconnectState {
  attempt: number;
  timer: NodeJS.Timeout | undefined;
}

type SshConnectionManagerLog = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export interface SshConnectionManagerDeps {
  loadConnectionRow?: (id: string) => Promise<SshConnectionRow | undefined>;
  resolveConnectConfig?: (row: SshConnectionRow) => Promise<SshConnectResult>;
  createClient?: () => Client;
  publishEvent?: (event: SshConnectionEvent) => void;
  log?: SshConnectionManagerLog;
}

const noopLog: SshConnectionManagerLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Implementation ──────────────────────────────────────────────────────────

export class SshConnectionManager extends EventEmitter {
  private readonly deps: Required<
    Pick<SshConnectionManagerDeps, 'createClient' | 'publishEvent' | 'log'>
  > &
    Pick<SshConnectionManagerDeps, 'loadConnectionRow' | 'resolveConnectConfig'>;

  constructor(deps: SshConnectionManagerDeps = {}) {
    super();
    this.deps = {
      loadConnectionRow: deps.loadConnectionRow,
      resolveConnectConfig: deps.resolveConnectConfig,
      createClient: deps.createClient ?? (() => new Ssh2Client()),
      publishEvent: deps.publishEvent ?? (() => {}),
      log: deps.log ?? noopLog,
    };
  }

  /** One stable proxy per connection ID — survives reconnects. */
  private proxies: Map<string, SshClientProxy> = new Map();

  private pendingConnections: Map<string, Promise<SshClientProxy>> = new Map();

  /** Tracks ongoing reconnect backoff state per connection. */
  private reconnecting: Map<string, ReconnectState> = new Map();

  private connectionCleanups: Map<string, () => void> = new Map();

  private activeClients: Map<string, Client> = new Map();

  private connectionGenerations: Map<string, number> = new Map();

  private healthStates: Map<string, SshHealthState> = new Map();

  /**
   * IDs for which disconnect() was called — these are excluded from
   * auto-reconnect so an intentional teardown is never silently restarted.
   */
  private intentionalDisconnects: Set<string> = new Set();

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Connect and register a client under the given ID.
   *
   * - Reuses an existing connection if already in the pool.
   * - Concurrent calls for the same ID coalesce to a single attempt.
   * - Throws SshAuthError, SshTimeoutError, or SshConnectionError on failure.
   */
  async connect(id: string): Promise<SshClientProxy> {
    this.intentionalDisconnects.delete(id);

    const existing = this.proxies.get(id);
    if (existing?.isConnected) return existing;

    const pending = this.pendingConnections.get(id);
    if (pending) return await pending;

    const generation = this.nextConnectionGeneration(id);
    this.emitConnecting(id);
    const connectionPromise = this.connectPersisted(id, generation);
    this.pendingConnections.set(id, connectionPromise);
    try {
      return await connectionPromise;
    } finally {
      if (this.pendingConnections.get(id) === connectionPromise) {
        this.pendingConnections.delete(id);
      }
    }
  }

  private async connectPersisted(id: string, generation: number): Promise<SshClientProxy> {
    if (!this.deps.loadConnectionRow || !this.deps.resolveConnectConfig) {
      throw new SshConnectionError('SSH connection manager is missing production dependencies');
    }

    const row = await this.deps.loadConnectionRow(id);
    if (
      !this.isCurrentConnectionGeneration(id, generation) ||
      this.intentionalDisconnects.has(id)
    ) {
      throw new SshConnectionError(`SSH connection '${id}' was disconnected before connecting`);
    }

    if (!row) {
      throw new SshConnectionError(`SSH connection '${id}' not found`);
    }

    const resolved = await this.deps.resolveConnectConfig(row);
    if (
      !this.isCurrentConnectionGeneration(id, generation) ||
      this.intentionalDisconnects.has(id)
    ) {
      resolved.cleanup();
      throw new SshConnectionError(`SSH connection '${id}' was disconnected before connecting`);
    }
    const connectionPromise = this.createConnection(id, resolved.config, resolved.cleanup, {
      emitConnecting: false,
      generation,
    });
    return await connectionPromise;
  }

  /** Get the stable SshClientProxy for a connection, or undefined. */
  getProxy(id: string): SshClientProxy | undefined {
    return this.proxies.get(id);
  }

  /** Returns true if the connection is currently live. */
  isConnected(id: string): boolean {
    return this.proxies.get(id)?.isConnected ?? false;
  }

  /** IDs of all connections that have a proxy (connected or reconnecting). */
  getConnectionIds(): string[] {
    return Array.from(this.proxies.keys());
  }

  /** Returns the current ConnectionState for a single connection ID. */
  getConnectionState(id: string): ConnectionState {
    if (this.proxies.get(id)?.isConnected) return 'connected';
    if (this.reconnecting.has(id)) return 'reconnecting';
    if (this.pendingConnections.has(id)) return 'connecting';
    return 'disconnected';
  }

  /** Returns the current ConnectionState for every tracked connection. */
  getAllConnectionStates(): Record<string, ConnectionState> {
    const result: Record<string, ConnectionState> = {};
    for (const id of this.proxies.keys()) {
      result[id] = this.getConnectionState(id);
    }
    for (const id of this.pendingConnections.keys()) {
      result[id] = this.getConnectionState(id);
    }
    return result;
  }

  getAllHealthStates(): Record<string, SshHealthState> {
    return Object.fromEntries(this.healthStates);
  }

  reportChannelError(connectionId: string, error: unknown): void {
    if (!isSshChannelOpenFailure(error)) return;

    this.healthStates.set(connectionId, { status: 'degraded' });
    this.emitHealthChanged(connectionId, { status: 'degraded' });
  }

  reportChannelRecovered(connectionId: string): void {
    this.clearHealthState(connectionId);
  }

  /**
   * Gracefully close a connection and permanently stop reconnection for it.
   * This is an intentional teardown — auto-reconnect will NOT fire afterward.
   */
  async disconnect(id: string): Promise<void> {
    this.intentionalDisconnects.add(id);
    this.nextConnectionGeneration(id);
    this.cancelReconnect(id);

    const proxy = this.proxies.get(id);
    if (!proxy?.isConnected) {
      this.deps.log.warn(
        'SshConnectionManager: disconnect called for unknown/inactive connection',
        {
          connectionId: id,
        }
      );
      const client = this.activeClients.get(id);
      if (client) {
        client.destroy();
      }
      this.runConnectionCleanup(id);
      this.proxies.delete(id);
      this.pendingConnections.delete(id);
      return;
    }

    this.deps.log.info('SshConnectionManager: disconnecting', { connectionId: id });

    const client = proxy.client;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.deps.log.warn('SshConnectionManager: disconnect timed out, forcing close', {
          connectionId: id,
        });
        client.destroy();
        proxy.invalidate();
        this.proxies.delete(id);
        this.runConnectionCleanup(id);
        resolve();
      }, 5_000);

      client.once('close', () => {
        clearTimeout(timeout);
        proxy.invalidate();
        this.proxies.delete(id);
        this.runConnectionCleanup(id);
        resolve();
      });

      client.end();
    });
  }

  /** Gracefully close all connections. */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(new Set([...this.proxies.keys(), ...this.pendingConnections.keys()]));
    this.deps.log.info('SshConnectionManager: disconnecting all connections', {
      count: ids.length,
    });
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Establish an ephemeral connection from a caller-supplied config.
   * The connection is marked intentional from the start so the close handler
   * never schedules a reconnect — callers are responsible for teardown via
   * `disconnect(id)`.
   */
  async connectFromConfig(
    id: string,
    config: ConnectConfig,
    cleanup: () => void = () => {}
  ): Promise<SshClientProxy> {
    this.intentionalDisconnects.add(id);
    const generation = this.nextConnectionGeneration(id);
    const connectionPromise = this.createConnection(id, config, cleanup, { generation });
    this.pendingConnections.set(id, connectionPromise);
    try {
      return await connectionPromise;
    } finally {
      this.pendingConnections.delete(id);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private createConnection(
    id: string,
    config: ConnectConfig,
    cleanup: () => void,
    options: { emitConnecting?: boolean; generation?: number } = {}
  ): Promise<SshClientProxy> {
    this.deps.log.info('SshConnectionManager: creating connection', {
      connectionId: id,
      host: config.host,
      username: config.username,
    });

    // Ensure a stable proxy exists for this ID.
    const proxy = this.proxies.get(id) ?? new SshClientProxy(id, this);
    this.proxies.set(id, proxy);

    const client = this.deps.createClient();
    let cleanupCalled = false;
    const cleanupOnce = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      this.connectionCleanups.delete(id);
      if (this.activeClients.get(id) === client) {
        this.activeClients.delete(id);
      }
      cleanup();
    };
    this.activeClients.set(id, client);
    this.connectionCleanups.set(id, cleanupOnce);

    return new Promise((resolve, reject) => {
      if (options.emitConnecting !== false) {
        this.emitConnecting(id);
      }

      let resolved = false;
      let connectedBeforeClose = false;
      let disconnectedEmitted = false;
      const resolveOnce = (p: SshClientProxy) => {
        if (!resolved) {
          resolved = true;
          resolve(p);
        }
      };
      const emitDisconnectedOnce = () => {
        if (disconnectedEmitted) return;
        disconnectedEmitted = true;
        this.emit('connection-event', {
          type: 'disconnected',
          connectionId: id,
        } satisfies SshConnectionManagerEvent);
        this.deps.publishEvent({ type: 'disconnected', connectionId: id });
      };

      client.on('error', (error: Error) => {
        this.deps.log.error('SshConnectionManager: connection error', {
          connectionId: id,
          error: error.message,
        });

        this.emit('connection-event', {
          type: 'error',
          connectionId: id,
          error,
        } satisfies SshConnectionManagerEvent);

        this.deps.publishEvent({
          type: 'error',
          connectionId: id,
          errorMessage: error.message,
        });

        if (proxy.isConnected && proxy.client === client) {
          connectedBeforeClose = true;
          proxy.invalidate();
          emitDisconnectedOnce();
        }
        cleanupOnce();
        reject(classifyError(error));
      });

      client.on('close', () => {
        this.deps.log.info('SshConnectionManager: connection closed', { connectionId: id });

        if (!resolved) {
          cleanupOnce();
          reject(new SshConnectionError('SSH connection closed before ready'));
          return;
        }

        // Only react if this client is still the one backing the proxy.
        if ((proxy.isConnected && proxy.client === client) || connectedBeforeClose) {
          const wasConnected = proxy.isConnected && proxy.client === client;
          proxy.invalidate();

          emitDisconnectedOnce();
          cleanupOnce();

          // Auto-reconnect unless this was an intentional disconnect or the
          // initial handshake never succeeded (resolved = false still).
          if (
            !this.intentionalDisconnects.has(id) &&
            resolved &&
            (wasConnected || connectedBeforeClose)
          ) {
            this.scheduleReconnect(id);
          }
        }
      });

      client.on('ready', () => {
        this.deps.log.info('SshConnectionManager: connection ready', { connectionId: id });

        if (
          options.generation !== undefined &&
          !this.isCurrentConnectionGeneration(id, options.generation)
        ) {
          cleanupOnce();
          client.end();
          reject(new SshConnectionError(`SSH connection '${id}' was disconnected before ready`));
          return;
        }

        proxy.update(client);
        this.clearHealthState(id);

        // Capture the remote login-shell profile once, non-blocking. Failures are
        // warned but do not prevent the connection from being used.
        proxy.getRemoteShellProfile().catch((err: unknown) => {
          this.deps.log.warn('SshConnectionManager: remote shell profile capture failed', {
            connectionId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        const isReconnect = this.reconnecting.has(id);
        this.cancelReconnect(id);

        this.emit('connection-event', {
          type: isReconnect ? 'reconnected' : 'connected',
          connectionId: id,
          proxy,
        } satisfies SshConnectionManagerEvent);

        this.deps.publishEvent({
          type: isReconnect ? 'reconnected' : 'connected',
          connectionId: id,
        });

        resolveOnce(proxy);
      });

      try {
        client.connect(config);
      } catch (error) {
        cleanupOnce();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private scheduleReconnect(id: string): void {
    const state = this.reconnecting.get(id) ?? { attempt: 0, timer: undefined };
    const attempt = state.attempt + 1;

    if (attempt > RECONNECT_DELAYS_MS.length) {
      this.deps.log.error('SshConnectionManager: max reconnect attempts reached', {
        connectionId: id,
      });
      this.reconnecting.delete(id);
      this.emit('connection-event', {
        type: 'reconnect-failed',
        connectionId: id,
      } satisfies SshConnectionManagerEvent);
      this.deps.publishEvent({ type: 'reconnect-failed', connectionId: id });
      return;
    }

    const delayMs = RECONNECT_DELAYS_MS[attempt - 1]!;

    this.deps.log.info('SshConnectionManager: scheduling reconnect', {
      connectionId: id,
      attempt,
      delayMs,
    });

    this.emit('connection-event', {
      type: 'reconnecting',
      connectionId: id,
      attempt,
      delayMs,
    } satisfies SshConnectionManagerEvent);

    this.deps.publishEvent({
      type: 'reconnecting',
      connectionId: id,
      attempt,
      delayMs,
    });

    const timer = setTimeout(() => {
      if (this.intentionalDisconnects.has(id)) {
        this.reconnecting.delete(id);
        return;
      }

      const connectionPromise = this.connect(id);
      this.pendingConnections.set(id, connectionPromise);

      connectionPromise
        .then(() => {
          this.pendingConnections.delete(id);
        })
        .catch((error: unknown) => {
          this.pendingConnections.delete(id);
          // Auth failures won't resolve with retries — stop immediately.
          if (error instanceof SshAuthError) {
            this.deps.log.error('SshConnectionManager: reconnect stopped — auth failure', {
              connectionId: id,
            });
            this.reconnecting.delete(id);
            this.emit('connection-event', {
              type: 'reconnect-failed',
              connectionId: id,
            } satisfies SshConnectionManagerEvent);
            this.deps.publishEvent({ type: 'reconnect-failed', connectionId: id });
          } else if (this.intentionalDisconnects.has(id)) {
            this.reconnecting.delete(id);
          } else {
            this.scheduleReconnect(id);
          }
        });
    }, delayMs);

    this.reconnecting.set(id, { attempt, timer });
  }

  private cancelReconnect(id: string): void {
    const state = this.reconnecting.get(id);
    if (state?.timer !== undefined) {
      clearTimeout(state.timer);
    }
    this.reconnecting.delete(id);
  }

  private runConnectionCleanup(id: string): void {
    this.connectionCleanups.get(id)?.();
  }

  private emitConnecting(id: string): void {
    this.emit('connection-event', {
      type: 'connecting',
      connectionId: id,
    } satisfies SshConnectionManagerEvent);

    this.deps.publishEvent({
      type: 'connecting',
      connectionId: id,
    });
  }

  private nextConnectionGeneration(id: string): number {
    const next = (this.connectionGenerations.get(id) ?? 0) + 1;
    this.connectionGenerations.set(id, next);
    return next;
  }

  private isCurrentConnectionGeneration(id: string, generation: number): boolean {
    return this.connectionGenerations.get(id) === generation;
  }

  private clearHealthState(connectionId: string): SshHealthState {
    const health: SshHealthState = { status: 'ok' };
    if (this.healthStates.delete(connectionId)) {
      this.emitHealthChanged(connectionId, health);
    }
    return health;
  }

  private emitHealthChanged(connectionId: string, health: SshHealthState): void {
    this.deps.publishEvent({
      type: 'health-changed',
      connectionId,
      health,
    });
  }
}

function classifyError(error: Error): SshAuthError | SshTimeoutError | SshConnectionError {
  const msg = error.message.toLowerCase();
  if (msg.includes('authentication') || msg.includes('auth') || msg.includes('permission denied')) {
    return new SshAuthError(error.message);
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return new SshTimeoutError(error.message);
  }
  return new SshConnectionError(error.message);
}
