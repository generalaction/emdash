import {
  mcpServerErrorChannel,
  mcpServerStatusChannel,
  type McpServerStatus,
} from '@shared/events/mcpServerEvents';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { McpHttpServer, McpServerStartError } from './http-server';
import { createMcpServer } from './server';
import { ensureTokenFile, readTokenFile, rotateToken as rotateTokenFile } from './token-store';

/**
 * Singleton service that owns the lifecycle of the in-process emdash MCP HTTP
 * server.
 *
 * Responsibilities (per `docs/superpowers/specs/2026-05-16-mcp-server-design.md`):
 * - Read `appSettings.mcpServer.{enabled,port}` and start/stop the
 *   loopback `McpHttpServer` accordingly.
 * - Get reconciled by the settings controller whenever those keys change
 *   (same pattern as `reconcileResourceSampler` — see
 *   `src/main/core/settings/controller.ts`).
 * - Ensure the bearer token file exists before starting the transport
 *   (`token-store.ensureTokenFile`).
 * - Emit `mcpServerStatusChannel` on every state change so the renderer
 *   Settings page can reflect status without polling.
 *
 * The service tolerates a partially-initialized MCP server (`createMcpServer`
 * may return `undefined`-shaped data while T4 wires the real registries),
 * but the current implementation always returns a real `McpServer`.
 */
export class McpServerService implements IInitializable, IDisposable {
  private readonly httpServer = new McpHttpServer();
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private currentEnabled = false;
  private currentPort: number | null = null;

  /**
   * Initial reconcile + emit. Idempotent: safe to call more than once
   * (subsequent calls behave like `reconcile()`).
   */
  async initialize(): Promise<void> {
    await this.reconcile();
  }

  async dispose(): Promise<void> {
    try {
      await this.httpServer.stop();
    } catch (err) {
      log.warn('[mcp-server] error during dispose', err);
    }
    this.startedAt = null;
    this.lastError = null;
    this.currentEnabled = false;
    this.currentPort = null;
  }

  /**
   * Returns the current status snapshot. Mirrors the payload emitted on
   * `mcpServerStatusChannel`.
   */
  async getStatus(): Promise<McpServerStatus> {
    const tokenFile = await readTokenFile();
    return {
      enabled: this.currentEnabled,
      running: this.httpServer.isRunning(),
      port: this.httpServer.getPort(),
      tokenPresent: tokenFile !== null,
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
      lastError: this.lastError,
    };
  }

  /**
   * Reconciles the live server against `appSettings.mcpServer`. Call this
   * from the settings controller whenever the `mcpServer` key changes; the
   * controller already follows the same pattern for `resourceMonitor`.
   *
   * - enabled flipped on  → ensure-token + start
   * - enabled flipped off → stop
   * - port changed while enabled → stop + ensure-token(newPort) + start
   * - no change → no-op
   */
  async reconcile(): Promise<void> {
    let settings: { enabled: boolean; port: number };
    try {
      settings = await appSettingsService.get('mcpServer');
    } catch (err) {
      log.error('[mcp-server] failed to read mcpServer settings', err);
      return;
    }

    const wasEnabled = this.currentEnabled;
    const previousPort = this.currentPort;

    if (!settings.enabled) {
      if (this.httpServer.isRunning()) {
        await this.stopAndEmit('disabled');
      }
      this.currentEnabled = false;
      this.currentPort = null;
      if (wasEnabled) {
        await this.emitStatus();
      }
      return;
    }

    const portChanged = previousPort !== null && previousPort !== settings.port;
    if (this.httpServer.isRunning() && !portChanged) {
      // Already running on the correct port — nothing to do.
      this.currentEnabled = true;
      this.currentPort = settings.port;
      return;
    }

    if (this.httpServer.isRunning()) {
      await this.stopAndEmit('port-change');
    }

    await this.startAndEmit(settings.port);
  }

  /**
   * Regenerates the bearer token, rewrites `~/.emdash/mcp.json`, and
   * reconciles the running server so all transports pick up the new token
   * (effectively kicking active sessions).
   *
   * Returns the freshly-generated token so the renderer can display it
   * exactly once on the Settings page.
   */
  async rotateToken(): Promise<{ token: string }> {
    let settings: { enabled: boolean; port: number };
    try {
      settings = await appSettingsService.get('mcpServer');
    } catch (err) {
      log.error('[mcp-server] failed to read mcpServer settings for rotateToken', err);
      throw err;
    }
    const port = this.currentPort ?? settings.port;
    const file = await rotateTokenFile(port);
    // Reconcile after rotation: if the server is enabled we restart it so the
    // HTTP transport reads the new token; this terminates all in-flight
    // sessions, which is the desired behaviour per spec ("terminates active
    // sessions so they reconnect with the new token").
    if (settings.enabled) {
      if (this.httpServer.isRunning()) {
        await this.stopAndEmit('port-change');
      }
      await this.startAndEmit(port);
    } else {
      await this.emitStatus();
    }
    return { token: file.token };
  }

  private async startAndEmit(port: number): Promise<void> {
    try {
      const tokenFile = await ensureTokenFile(port);
      const mcpServer = createMcpServer();
      // Defensive: if a future refactor reverts `createMcpServer` to a stub,
      // skip starting rather than crash. The spec contract is that the
      // service tolerates an absent server until tools are wired up.
      if (!mcpServer) {
        this.lastError = 'createMcpServer() returned no server; transport not started.';
        log.warn('[mcp-server]', this.lastError);
        await this.emitStatus();
        return;
      }
      const { port: boundPort } = await this.httpServer.start({
        port,
        token: tokenFile.token,
        mcpServer,
      });
      this.startedAt = Date.now();
      this.lastError = null;
      this.currentEnabled = true;
      this.currentPort = boundPort;
      log.info(`[mcp-server] listening on 127.0.0.1:${boundPort}`);
      await this.emitStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.currentEnabled = true; // user intent is still "enabled"
      this.currentPort = port;
      this.startedAt = null;
      log.error('[mcp-server] failed to start', err);
      events.emit(mcpServerErrorChannel, {
        code: err instanceof McpServerStartError ? err.code : 'BIND_FAILED',
        message,
      });
      await this.emitStatus();
    }
  }

  private async stopAndEmit(reason: 'disabled' | 'port-change' | 'dispose'): Promise<void> {
    try {
      await this.httpServer.stop();
      log.info(`[mcp-server] stopped (${reason})`);
    } catch (err) {
      log.warn('[mcp-server] error stopping http server', err);
    }
    this.startedAt = null;
  }

  private async emitStatus(): Promise<void> {
    try {
      const status = await this.getStatus();
      events.emit(mcpServerStatusChannel, status);
    } catch (err) {
      log.warn('[mcp-server] failed to emit status', err);
    }
  }
}

export const mcpServerService = new McpServerService();
