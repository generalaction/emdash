import { join } from 'node:path';
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
 * Returns the command external MCP clients should run to spawn the
 * `emdash-mcp` stdio bridge.
 *
 * - **Packaged app:** the bridge JS lives in the unpacked resources directory
 *   (`process.resourcesPath/bin/emdash-mcp.js`, configured in
 *   `electron-builder.config.ts`). We invoke it via the platform Node, so the
 *   user never has to chmod or codesign anything themselves.
 * - **Dev / test:** the bundled output sits at `out/main/emdash-mcp.js` after
 *   `electron-vite build`. We point at it relative to the cwd; if the file
 *   doesn't exist yet (fresh checkout that hasn't been built) the snippet
 *   still tells the developer the correct command — running it without a
 *   build will fail loudly, which is the correct signal.
 *
 * The exposed shape is `{ command, args }` rather than a single string so the
 * snippet generator can emit each transport's preferred config format
 * (Claude Code uses `command + args`, Codex uses TOML keys, etc.).
 */
export interface BridgeCommand {
  command: string;
  args: string[];
}

export function getBridgeCommand(): BridgeCommand {
  // `process.resourcesPath` is only set when running inside the Electron
  // runtime (and even then is only meaningful for the packaged app).
  // `process.defaultApp` is `true` in `electron .` dev mode and `undefined`
  // in the packaged app — the inverse of the packaged check we want here.
  // Together they let us decide between the dev path and the packaged path
  // without taking a hard runtime dependency on the `electron` module
  // (which keeps unit tests happy without `vi.mock('electron', …)`).
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const isPackaged =
    typeof resourcesPath === 'string' &&
    resourcesPath.length > 0 &&
    (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp !== true;

  const bridgeFileName = 'emdash-mcp.js';
  const bridgePath = isPackaged
    ? join(resourcesPath as string, 'bin', bridgeFileName)
    : join(process.cwd(), 'out', 'main', bridgeFileName);

  // `node` is universally available wherever Electron itself runs (and the
  // packaged app ships its own; advanced users can override `command` in
  // their MCP client config if they prefer a specific runtime).
  return {
    command: 'node',
    args: [bridgePath],
  };
}

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
      // Pass `createMcpServer` itself as the factory — each new HTTP session
      // gets its own McpServer instance (the SDK forbids reusing one across
      // transports). Smoke-check by minting one upfront so we fail loudly at
      // start time rather than on the first client request.
      const probe = createMcpServer();
      if (!probe) {
        this.lastError = 'createMcpServer() returned no server; transport not started.';
        log.warn('[mcp-server]', this.lastError);
        await this.emitStatus();
        return;
      }
      // The probe was just a sanity check; close it so it doesn't leak.
      await probe.close().catch(() => {});
      const { port: boundPort } = await this.httpServer.start({
        port,
        token: tokenFile.token,
        mcpServerFactory: () => createMcpServer(),
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
