import { EventEmitter } from 'node:events';
import { Client, type ConnectConfig } from 'ssh2';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import type { ConnectionState } from '@shared/ssh/types';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@main/lib/result';
import { SshClientProxy } from './ssh-client-proxy';

export type SshConnectionEvent =
  | { type: 'connected'; connectionId: string; proxy: SshClientProxy }
  | { type: 'disconnected'; connectionId: string }
  | { type: 'reconnecting'; connectionId: string; attempt: number; delayMs: number }
  | { type: 'reconnected'; connectionId: string; proxy: SshClientProxy }
  | { type: 'reconnect-failed'; connectionId: string }
  | { type: 'error'; connectionId: string; error: Error };

export type SshConnectError =
  | { kind: 'auth-failed'; message: string }
  | { kind: 'connect-failed'; message: string }
  | { kind: 'timeout'; message: string };

// ─── Configuration ────────────────────────────────────────────────────────────

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

  private pendingConnections: Map<string, Promise<Result<SshClientProxy, SshConnectError>>> =
    new Map();

  /** Configs stored for reconnection. */
  private storedConfigs: Map<string, ConnectConfig> = new Map();

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
   * - Returns the stable SshClientProxy for this connection so callers can
   *   hold a reference that survives reconnects.
   */
  async connect(
    id: string,
    config: ConnectConfig
  ): Promise<Result<SshClientProxy, SshConnectError>> {
    this.intentionalDisconnects.delete(id);

    const existing = this.proxies.get(id);
    if (existing?.isConnected) {
      log.info('SshConnectionManager: reusing existing connection', { connectionId: id });
      return ok(existing);
    }

    const pending = this.pendingConnections.get(id);
    if (pending) {
      log.info('SshConnectionManager: coalescing to in-flight connection', { connectionId: id });
      return pending;
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
      this.storedConfigs.delete(id);
      return;
    }

    log.info('SshConnectionManager: disconnecting', { connectionId: id });

    const client = proxy.client;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('SshConnectionManager: disconnect timed out, forcing close', { connectionId: id });
        proxy.invalidate();
        this.proxies.delete(id);
        this.storedConfigs.delete(id);
        resolve();
      }, 5_000);

      client.once('close', () => {
        clearTimeout(timeout);
        proxy.invalidate();
        this.proxies.delete(id);
        this.storedConfigs.delete(id);
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

  // ─── Internals ────────────────────────────────────────────────────────────

  private createConnection(
    id: string,
    config: ConnectConfig
  ): Promise<Result<SshClientProxy, SshConnectError>> {
    log.info('SshConnectionManager: creating connection', {
      connectionId: id,
      host: config.host,
      username: config.username,
    });

    this.storedConfigs.set(id, config);

    // Ensure a stable proxy exists for this ID.
    const proxy = this.proxies.get(id) ?? new SshClientProxy();
    this.proxies.set(id, proxy);

    const client = new Client();

    return new Promise((resolve) => {
      let resolved = false;
      const resolveOnce = (result: Result<SshClientProxy, SshConnectError>) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
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

        resolveOnce(err(classifyError(error)));
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

        resolveOnce(ok(proxy));
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

      const config = this.storedConfigs.get(id);
      if (!config) {
        this.reconnecting.delete(id);
        return;
      }

      const connectionPromise = this.createConnection(id, config);
      this.pendingConnections.set(id, connectionPromise);

      connectionPromise
        .then((result) => {
          if (!result.success) {
            const error = result.error;
            // Auth failures won't resolve with retries — stop immediately.
            if (error.kind === 'auth-failed') {
              log.error('SshConnectionManager: reconnect stopped — auth failure', {
                connectionId: id,
              });
              this.reconnecting.delete(id);
              this.emit('connection-event', {
                type: 'reconnect-failed',
                connectionId: id,
              } satisfies SshConnectionEvent);
              events.emit(sshConnectionEventChannel, {
                type: 'reconnect-failed',
                connectionId: id,
              });
            } else {
              this.scheduleReconnect(id);
            }
          }
        })
        .finally(() => {
          this.pendingConnections.delete(id);
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

function classifyError(error: Error): SshConnectError {
  const msg = error.message.toLowerCase();

  if (msg.includes('authentication') || msg.includes('auth') || msg.includes('permission denied')) {
    return { kind: 'auth-failed', message: error.message };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { kind: 'timeout', message: error.message };
  }
  return { kind: 'connect-failed', message: error.message };
}
