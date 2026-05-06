import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { Client, type ConnectConfig } from 'ssh2';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import type { ConnectionState } from '@shared/ssh';
import { db } from '@main/db/client';
import { sshConnections } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { buildConnectConfigFromRow } from './build-connect-config';
import { SshClientProxy } from './ssh-client-proxy';

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

export type SshConnectionEvent =
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

// ─── Implementation ──────────────────────────────────────────────────────────

export class SshConnectionManager extends EventEmitter {
  /** One stable proxy per connection ID — survives reconnects. */
  private proxies: Map<string, SshClientProxy> = new Map();

  private pendingConnections: Map<string, Promise<SshClientProxy>> = new Map();

  /** Tracks ongoing reconnect backoff state per connection. */
  private reconnecting: Map<string, ReconnectState> = new Map();

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

    const [row] = await db.select().from(sshConnections).where(eq(sshConnections.id, id)).limit(1);

    if (!row) {
      throw new SshConnectionError(`SSH connection '${id}' not found`);
    }

    const config = await buildConnectConfigFromRow(row);
    if (!config) {
      throw new SshConnectionError(`SSH connection '${id}' has unsupported auth configuration`);
    }
    const connectionPromise = this.createConnection(id, config);
    this.pendingConnections.set(id, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.pendingConnections.delete(id);
    }
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
    return result;
  }

  /**
   * Gracefully close a connection and permanently stop reconnection for it.
   * This is an intentional teardown — auto-reconnect will NOT fire afterward.
   */
  async disconnect(id: string): Promise<void> {
    this.intentionalDisconnects.add(id);
    this.cancelReconnect(id);

    const proxy = this.proxies.get(id);
    if (!proxy?.isConnected) {
      log.warn('SshConnectionManager: disconnect called for unknown/inactive connection', {
        connectionId: id,
      });
      this.proxies.delete(id);
      return;
    }

    log.info('SshConnectionManager: disconnecting', { connectionId: id });

    const client = proxy.client;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('SshConnectionManager: disconnect timed out, forcing close', { connectionId: id });
        proxy.invalidate();
        this.proxies.delete(id);
        resolve();
      }, 5_000);

      client.once('close', () => {
        clearTimeout(timeout);
        proxy.invalidate();
        this.proxies.delete(id);
        resolve();
      });

      client.end();
    });
  }

  /** Gracefully close all connections. */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.proxies.keys());
    log.info('SshConnectionManager: disconnecting all connections', { count: ids.length });
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Establish an ephemeral connection from a caller-supplied config.
   * The connection is marked intentional from the start so the close handler
   * never schedules a reconnect — callers are responsible for teardown via
   * `disconnect(id)`.
   */
  async connectFromConfig(id: string, config: ConnectConfig): Promise<SshClientProxy> {
    this.intentionalDisconnects.add(id);
    const connectionPromise = this.createConnection(id, config);
    this.pendingConnections.set(id, connectionPromise);
    try {
      return await connectionPromise;
    } finally {
      this.pendingConnections.delete(id);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private createConnection(id: string, config: ConnectConfig): Promise<SshClientProxy> {
    log.info('SshConnectionManager: creating connection', {
      connectionId: id,
      host: config.host,
      username: config.username,
    });

    // Ensure a stable proxy exists for this ID.
    const proxy = this.proxies.get(id) ?? new SshClientProxy();
    this.proxies.set(id, proxy);

    const client = new Client();

    return new Promise((resolve, reject) => {
      this.emit('connection-event', {
        type: 'connecting',
        connectionId: id,
      } satisfies SshConnectionEvent);

      events.emit(sshConnectionEventChannel, {
        type: 'connecting',
        connectionId: id,
      });

      let resolved = false;
      const resolveOnce = (p: SshClientProxy) => {
        if (!resolved) {
          resolved = true;
          resolve(p);
        }
      };

      client.on('error', (error: Error) => {
        log.error('SshConnectionManager: connection error', {
          connectionId: id,
          error: error.message,
        });

        this.emit('connection-event', {
          type: 'error',
          connectionId: id,
          error,
        } satisfies SshConnectionEvent);

        events.emit(sshConnectionEventChannel, {
          type: 'error',
          connectionId: id,
          errorMessage: error.message,
        });

        reject(classifyError(error));
      });

      client.on('close', () => {
        log.info('SshConnectionManager: connection closed', { connectionId: id });

        // Only react if this client is still the one backing the proxy.
        if (proxy.isConnected && proxy.client === client) {
          proxy.invalidate();

          this.emit('connection-event', {
            type: 'disconnected',
            connectionId: id,
          } satisfies SshConnectionEvent);

          events.emit(sshConnectionEventChannel, { type: 'disconnected', connectionId: id });

          // Auto-reconnect unless this was an intentional disconnect or the
          // initial handshake never succeeded (resolved = false still).
          if (!this.intentionalDisconnects.has(id) && resolved) {
            this.scheduleReconnect(id);
          }
        }
      });

      client.on('ready', () => {
        log.info('SshConnectionManager: connection ready', { connectionId: id });

        proxy.update(client);

        // Capture the remote login-shell profile once, non-blocking. Failures are
        // warned but do not prevent the connection from being used.
        proxy.getRemoteShellProfile().catch((err: unknown) => {
          log.warn('SshConnectionManager: remote shell profile capture failed', {
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
        } satisfies SshConnectionEvent);

        events.emit(sshConnectionEventChannel, {
          type: isReconnect ? 'reconnected' : 'connected',
          connectionId: id,
        });

        resolveOnce(proxy);
      });

      client.connect(config);
    });
  }

  private scheduleReconnect(id: string): void {
    const state = this.reconnecting.get(id) ?? { attempt: 0, timer: undefined };
    const attempt = state.attempt + 1;

    if (attempt > RECONNECT_DELAYS_MS.length) {
      log.error('SshConnectionManager: max reconnect attempts reached', { connectionId: id });
      this.reconnecting.delete(id);
      this.emit('connection-event', {
        type: 'reconnect-failed',
        connectionId: id,
      } satisfies SshConnectionEvent);
      events.emit(sshConnectionEventChannel, { type: 'reconnect-failed', connectionId: id });
      return;
    }

    const delayMs = RECONNECT_DELAYS_MS[attempt - 1]!;

    log.info('SshConnectionManager: scheduling reconnect', {
      connectionId: id,
      attempt,
      delayMs,
    });

    this.emit('connection-event', {
      type: 'reconnecting',
      connectionId: id,
      attempt,
      delayMs,
    } satisfies SshConnectionEvent);

    events.emit(sshConnectionEventChannel, {
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
            log.error('SshConnectionManager: reconnect stopped — auth failure', {
              connectionId: id,
            });
            this.reconnecting.delete(id);
            this.emit('connection-event', {
              type: 'reconnect-failed',
              connectionId: id,
            } satisfies SshConnectionEvent);
            events.emit(sshConnectionEventChannel, { type: 'reconnect-failed', connectionId: id });
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
}

export const sshConnectionManager = new SshConnectionManager();

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
