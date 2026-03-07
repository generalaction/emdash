import { EventEmitter } from 'node:events';
import { Client, type ConnectConfig } from 'ssh2';
import { log } from '../lib/logger';
import type { Result } from '../../lib/result';
import { ok, err } from '../../lib/result';

export interface SshConnection {
  id: string;
  client: Client;
  connectedAt: Date;
}

export type SshConnectionEvent =
  | { type: 'connected'; connectionId: string; client: Client }
  | { type: 'disconnected'; connectionId: string }
  | { type: 'reconnecting'; connectionId: string; attempt: number; delayMs: number }
  | { type: 'reconnected'; connectionId: string; client: Client }
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
  private connections: Map<string, SshConnection> = new Map();
  private pendingConnections: Map<string, Promise<Result<Client, SshConnectError>>> = new Map();

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
   * - Clears any intentional-disconnect flag so auto-reconnect resumes
   *   if the connection later drops unexpectedly.
   */
  async connect(id: string, config: ConnectConfig): Promise<Result<Client, SshConnectError>> {
    this.intentionalDisconnects.delete(id);

    const existing = this.connections.get(id);
    if (existing) {
      log.info('SshConnectionManager: reusing existing connection', { connectionId: id });
      return ok(existing.client);
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

  /** Get the ssh2.Client for an active connection, or undefined. */
  getClient(id: string): Client | undefined {
    return this.connections.get(id)?.client;
  }

  /** Returns true if the connection is in the pool. */
  isConnected(id: string): boolean {
    return this.connections.has(id);
  }

  /** IDs of all currently-connected clients. */
  getConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Gracefully close a connection and permanently stop reconnection for it.
   * This is an intentional teardown — auto-reconnect will NOT fire afterward.
   */
  async disconnect(id: string): Promise<void> {
    this.intentionalDisconnects.add(id);
    this.cancelReconnect(id);

    const conn = this.connections.get(id);
    if (!conn) {
      log.warn('SshConnectionManager: disconnect called for unknown connection', {
        connectionId: id,
      });
      return;
    }

    log.info('SshConnectionManager: disconnecting', { connectionId: id });

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('SshConnectionManager: disconnect timed out, forcing close', { connectionId: id });
        resolve();
      }, 5_000);

      conn.client.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      conn.client.end();
    });
  }

  /** Gracefully close all connections. */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    log.info('SshConnectionManager: disconnecting all connections', { count: ids.length });
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private createConnection(
    id: string,
    config: ConnectConfig
  ): Promise<Result<Client, SshConnectError>> {
    log.info('SshConnectionManager: creating connection', {
      connectionId: id,
      host: config.host,
      username: config.username,
    });

    this.storedConfigs.set(id, config);

    const client = new Client();

    return new Promise((resolve) => {
      let resolved = false;
      const resolveOnce = (result: Result<Client, SshConnectError>) => {
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

        if (this.connections.get(id)?.client === client) {
          this.connections.delete(id);
          this.emit('connection-event', {
            type: 'disconnected',
            connectionId: id,
          } satisfies SshConnectionEvent);

          // Auto-reconnect unless this was an intentional disconnect
          // or the initial handshake failed (not yet resolved as 'ok').
          if (!this.intentionalDisconnects.has(id) && resolved) {
            this.scheduleReconnect(id);
          }
        }
      });

      client.on('ready', () => {
        log.info('SshConnectionManager: connection ready', { connectionId: id });

        this.connections.set(id, { id, client, connectedAt: new Date() });

        const isReconnect = this.reconnecting.has(id);
        this.cancelReconnect(id);

        this.emit('connection-event', {
          type: isReconnect ? 'reconnected' : 'connected',
          connectionId: id,
          client,
        } satisfies SshConnectionEvent);

        resolveOnce(ok(client));
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

    const timer = setTimeout(() => {
      // Guard: caller may have disconnected() while we were waiting
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
