import { EventEmitter } from 'events';
import { ConnectionState, SshConfig } from '../../../shared/ssh/types';
import { ConnectionMetrics } from './types';

/**
 * Extended metrics with monitoring state
 */
interface MonitoredConnection {
  connectionId: string;
  state: ConnectionState;
  config: SshConfig;
  metrics: ConnectionMetrics;
  reconnectAttempts: number;
  lastError?: string;
}

/**
 * Callback that checks whether a connection is still alive in the real
 * connection pool (e.g. SshService.isConnected).
 */
export type ConnectionChecker = (connectionId: string) => boolean;

/**
 * Events emitted by SshConnectionMonitor:
 * - 'stateChange': (connectionId: string, state: ConnectionState, error?: string) => void
 * - 'healthCheck': (connectionId: string, isHealthy: boolean, latencyMs: number) => void
 * - 'reconnect': (connectionId: string, config: SshConfig, attempt: number) => void
 * - 'reconnectFailed': (connectionId: string, error: string) => void
 * - 'metrics': (connectionId: string, metrics: ConnectionMetrics) => void
 */

/**
 * Service for monitoring SSH connection health and metrics.
 *
 * Instead of maintaining its own ping timer (which was never wired up and
 * caused phantom reconnect loops), the monitor now delegates liveness
 * checks to a `connectionChecker` callback — typically
 * `SshService.isConnected()`. ssh2's built-in keepalive
 * (`keepaliveInterval` / `keepaliveCountMax`) handles the actual TCP
 * liveness; when the connection drops, ssh2 emits `close` which removes
 * the connection from the pool and SshService emits `disconnected`.
 *
 * The monitor reacts to that signal (via `handleDisconnect`) and triggers
 * reconnect with exponential backoff. The periodic health check is now a
 * safety net that detects pool removal the monitor didn't hear about.
 */
export class SshConnectionMonitor extends EventEmitter {
  private connections: Map<string, MonitoredConnection> = new Map();
  private checkInterval?: NodeJS.Timeout;
  private readonly DEFAULT_INTERVAL_MS = 30000; // 30 seconds
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_BACKOFF_MS = [1000, 5000, 15000]; // Exponential backoff delays
  private connectionChecker: ConnectionChecker;

  constructor(connectionChecker?: ConnectionChecker) {
    super();
    // Default: always report alive (no-op). Caller should provide a real checker.
    this.connectionChecker = connectionChecker ?? (() => true);
  }

  /**
   * Starts monitoring a connection.
   * @param connectionId - ID of the connection to monitor
   * @param config - SSH configuration for potential reconnection
   */
  startMonitoring(connectionId: string, config: SshConfig): void {
    // Don't duplicate monitoring
    if (this.connections.has(connectionId)) {
      return;
    }

    const now = new Date();
    const monitored: MonitoredConnection = {
      connectionId,
      state: 'connected',
      config,
      metrics: {
        connectionId,
        bytesSent: 0,
        bytesReceived: 0,
        latencyMs: 0,
        lastPingAt: now,
      },
      reconnectAttempts: 0,
    };

    this.connections.set(connectionId, monitored);
    this.emit('stateChange', connectionId, 'connected');

    // Start health checks if not already running
    if (!this.checkInterval) {
      this.startHealthChecks();
    }
  }

  /**
   * Stops monitoring a connection.
   * @param connectionId - ID of the connection to stop monitoring
   */
  stopMonitoring(connectionId: string): void {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return;
    }

    // Emit disconnected state before removing
    if (monitored.state !== 'disconnected') {
      this.emit('stateChange', connectionId, 'disconnected');
    }

    this.connections.delete(connectionId);

    // Stop health checks if no more connections
    if (this.connections.size === 0) {
      this.stopHealthChecks();
    }
  }

  /**
   * Called when SshService reports a real disconnect (ssh2 `close` event).
   * Triggers reconnect with backoff if the connection is still being monitored.
   */
  handleDisconnect(connectionId: string): void {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return;
    }

    // Ignore if already reconnecting or disconnected
    if (monitored.state === 'connecting' || monitored.state === 'disconnected') {
      return;
    }

    this.updateState(connectionId, 'error', 'Connection lost');
    this.attemptReconnect(connectionId);
  }

  /**
   * Updates the connection state.
   * @param connectionId - ID of the connection
   * @param state - New connection state
   * @param error - Optional error message
   */
  updateState(connectionId: string, state: ConnectionState, error?: string): void {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return;
    }

    const previousState = monitored.state;
    monitored.state = state;

    if (error) {
      monitored.lastError = error;
    }

    // Reset reconnect attempts on successful connection
    if (state === 'connected' && previousState !== 'connected') {
      monitored.reconnectAttempts = 0;
      monitored.lastError = undefined;
    }

    this.emit('stateChange', connectionId, state, error);
  }

  /**
   * Gets the current connection state.
   * @param connectionId - ID of the connection
   * @returns Current connection state or 'disconnected' if not monitored
   */
  getState(connectionId: string): ConnectionState {
    const monitored = this.connections.get(connectionId);
    return monitored?.state ?? 'disconnected';
  }

  /**
   * Updates metrics for a connection.
   * @param connectionId - ID of the connection
   * @param metrics - Partial metrics to update
   */
  updateMetrics(connectionId: string, metrics: Partial<ConnectionMetrics>): void {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return;
    }

    const updatedMetrics = { ...monitored.metrics, ...metrics };
    monitored.metrics = updatedMetrics;

    this.emit('metrics', connectionId, updatedMetrics);
  }

  /**
   * Gets current metrics for a connection.
   * @param connectionId - ID of the connection
   * @returns Current metrics or null if not monitoring
   */
  getMetrics(connectionId: string): ConnectionMetrics | null {
    const monitored = this.connections.get(connectionId);
    return monitored?.metrics ?? null;
  }

  /**
   * Starts periodic health checks for all monitored connections.
   * @param intervalMs - Check interval in milliseconds (default: 30 seconds)
   */
  startHealthChecks(intervalMs: number = this.DEFAULT_INTERVAL_MS): void {
    this.stopHealthChecks();
    this.checkInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);
  }

  /**
   * Stops periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Checks if a connection is healthy by querying the real connection pool.
   * @param connectionId - ID of the connection
   * @returns True if connection is healthy
   */
  async isHealthy(connectionId: string): Promise<boolean> {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return false;
    }

    if (monitored.state !== 'connected') {
      return false;
    }

    return this.connectionChecker(connectionId);
  }

  /**
   * Gets all monitored connection IDs and their states.
   * @returns Array of connection ID and state pairs
   */
  getAllStates(): Array<{ connectionId: string; state: ConnectionState }> {
    return Array.from(this.connections.entries()).map(([id, monitored]) => ({
      connectionId: id,
      state: monitored.state,
    }));
  }

  /**
   * Gets the configuration for a monitored connection.
   * Used for reconnection attempts.
   * @param connectionId - ID of the connection
   * @returns SSH configuration or null if not monitored
   */
  getConfig(connectionId: string): SshConfig | null {
    const monitored = this.connections.get(connectionId);
    return monitored?.config ?? null;
  }

  /**
   * Gets detailed connection info including metrics and state.
   * @param connectionId - ID of the connection
   * @returns Detailed connection info or null if not monitored
   */
  getConnectionInfo(connectionId: string): {
    state: ConnectionState;
    metrics: ConnectionMetrics;
    reconnectAttempts: number;
    lastError?: string;
  } | null {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return null;
    }

    return {
      state: monitored.state,
      metrics: { ...monitored.metrics },
      reconnectAttempts: monitored.reconnectAttempts,
      lastError: monitored.lastError,
    };
  }

  /**
   * Disposes of the monitor and cleans up all resources.
   * Stops health checks, clears all connections, and removes all listeners.
   */
  dispose(): void {
    this.stopHealthChecks();

    // Emit disconnected for all monitored connections
    for (const [connectionId, monitored] of this.connections) {
      if (monitored.state !== 'disconnected') {
        this.emit('stateChange', connectionId, 'disconnected', 'Monitor disposed');
      }
    }

    this.connections.clear();
    this.removeAllListeners();
  }

  /**
   * Performs health checks on all monitored connections.
   * Called periodically by the health check interval.
   *
   * Instead of relying on a lastPingAt timer (which was never updated),
   * this now queries the real connection pool via connectionChecker.
   * ssh2's keepalive handles TCP liveness; we just verify the connection
   * is still in the pool.
   */
  private performHealthChecks(): void {
    for (const [connectionId, monitored] of this.connections) {
      // Skip connections that are already connecting or reconnecting
      if (monitored.state === 'connecting') {
        continue;
      }

      // Skip connections that are already disconnected
      if (monitored.state === 'disconnected') {
        continue;
      }

      const isAlive = this.connectionChecker(connectionId);
      this.emit('healthCheck', connectionId, isAlive, monitored.metrics.latencyMs);

      // If the monitor thinks it's connected but the pool says otherwise,
      // the connection was dropped (e.g. ssh2 close event happened but
      // the monitor's handleDisconnect was somehow missed). Trigger reconnect.
      if (!isAlive && monitored.state === 'connected') {
        this.updateState(connectionId, 'error', 'Connection no longer in pool');
        this.attemptReconnect(connectionId);
      }
    }
  }

  /**
   * Attempts to reconnect a connection with exponential backoff.
   * @param connectionId - ID of the connection to reconnect
   */
  private async attemptReconnect(connectionId: string): Promise<void> {
    const monitored = this.connections.get(connectionId);
    if (!monitored) {
      return;
    }

    // Check if we've exceeded max reconnection attempts
    if (monitored.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      const error = `Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached`;
      this.updateState(connectionId, 'disconnected', error);
      this.emit('reconnectFailed', connectionId, error);
      return;
    }

    // Increment attempt counter
    monitored.reconnectAttempts++;

    // Calculate backoff delay
    const delayIndex = Math.min(
      monitored.reconnectAttempts - 1,
      this.RECONNECT_BACKOFF_MS.length - 1
    );
    const delay = this.RECONNECT_BACKOFF_MS[delayIndex];

    // Update state to connecting
    this.updateState(connectionId, 'connecting');

    // Wait for backoff delay before emitting reconnect event
    await this.sleep(delay);

    // Re-check that connection is still being monitored and still needs reconnection
    const current = this.connections.get(connectionId);
    if (!current || current.state !== 'connecting') {
      return;
    }

    // Emit reconnect event for the service to handle
    this.emit('reconnect', connectionId, monitored.config, monitored.reconnectAttempts);
  }

  /**
   * Utility method for async delay.
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
