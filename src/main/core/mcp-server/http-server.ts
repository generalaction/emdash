import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '@main/lib/logger';

/**
 * Loopback bind address. Hard-coded — the spec is explicit that emdash MCP
 * is loopback-only. Never bind to `0.0.0.0`, never accept LAN traffic.
 */
const LOOPBACK_HOST = '127.0.0.1';

/** The single endpoint the MCP transport answers on. */
const MCP_ENDPOINT = '/mcp';

/** Header used by stateful `StreamableHTTPServerTransport` sessions. */
const MCP_SESSION_HEADER = 'mcp-session-id';

/**
 * Typed startup failure. Surface this through the service so the renderer
 * can show a useful Settings-page error (e.g. "port already in use").
 */
export class McpServerStartError extends Error {
  constructor(
    public readonly code: 'PORT_IN_USE' | 'BIND_FAILED' | 'ALREADY_RUNNING',
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'McpServerStartError';
  }
}

export interface McpHttpServerStartOptions {
  port: number;
  token: string;
  /**
   * Builds a fresh `McpServer` for each new session.
   *
   * The MCP SDK forbids connecting a single `McpServer` to more than one
   * transport at a time, and `StreamableHTTPServerTransport` is one transport
   * per HTTP session. So every new session needs its own `McpServer`. Tool
   * and resource registration is cheap (just map inserts), and per-session
   * isolation also keeps any per-connection state — subscriptions, request
   * handlers — from leaking between clients.
   */
  mcpServerFactory: () => McpServer;
}

/**
 * Loopback HTTP transport for the emdash MCP server.
 *
 * Responsibilities:
 * - Bind a Node `http.Server` to `127.0.0.1:<port>` (loopback only).
 * - Reject requests whose `Host` header is not `127.0.0.1:<port>` or
 *   `localhost:<port>` (DNS-rebinding mitigation, HTTP 421).
 * - Require `Authorization: Bearer <token>` matching the configured token,
 *   compared in constant time (HTTP 401 on missing/mismatch).
 * - Hand authenticated requests to the SDK `StreamableHTTPServerTransport`
 *   bound to the supplied `McpServer`.
 * - Surface `EADDRINUSE` as a typed `McpServerStartError`.
 *
 * NOT responsible for:
 * - Tool / resource registration (see `server.ts` and the `tools/` +
 *   `resources/` modules).
 * - Token storage or rotation (see `token-store.ts`).
 * - Settings reconciliation (see `service.ts`).
 */
export class McpHttpServer {
  private httpServer: NodeHttpServer | null = null;
  private boundPort: number | null = null;
  private tokenBuffer: Buffer | null = null;

  /**
   * One session entry per active client. The SDK transport is stateful — for
   * SSE subscriptions to work across multiple HTTP requests the client must
   * keep sending the same `mcp-session-id`, and we must hand the request to
   * the same transport (and its bound `McpServer`) each time.
   *
   * Each session pairs a `StreamableHTTPServerTransport` with the
   * `McpServer` it's connected to. We keep a reference to the `McpServer` so
   * we can `close()` it when the session ends, releasing per-session
   * subscriptions and handlers held by the SDK.
   */
  private readonly sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; mcpServer: McpServer }
  >();

  /**
   * Factory for the active run. Invoked once per new session to mint an
   * `McpServer` with the full tool / resource catalog registered.
   */
  private mcpServerFactory: (() => McpServer) | null = null;

  /**
   * Starts the HTTP server. Rejects with `McpServerStartError` on bind
   * failure (typically `EADDRINUSE`). Resolves with the actually-bound port.
   *
   * `port: 0` is allowed and asks the OS to pick an ephemeral port (used by
   * tests). The resolved value reflects what the OS gave us.
   */
  async start(opts: McpHttpServerStartOptions): Promise<{ port: number }> {
    if (this.httpServer) {
      throw new McpServerStartError(
        'ALREADY_RUNNING',
        'MCP HTTP server is already running; call stop() first.'
      );
    }
    if (!opts.token || typeof opts.token !== 'string') {
      throw new Error('McpHttpServer.start requires a non-empty token');
    }

    this.tokenBuffer = Buffer.from(opts.token, 'utf8');
    this.mcpServerFactory = opts.mcpServerFactory;

    const server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        log.error('[mcp-server] unhandled error in request handler', err);
        if (!res.headersSent) {
          this.respondJson(res, 500, { error: 'internal_error' });
        } else {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      });
    });

    // Reject WebSocket / CONNECT upgrade attempts outright. The MCP transport
    // only needs HTTP (with SSE streaming as the response body); we don't want
    // accidental upgrade routes that bypass auth.
    server.on('upgrade', (_req, socket) => {
      socket.destroy();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        // IMPORTANT: bind to loopback only. Never pass undefined / '0.0.0.0'.
        server.listen(opts.port, LOOPBACK_HOST);
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        throw new McpServerStartError(
          'PORT_IN_USE',
          `MCP server cannot bind to ${LOOPBACK_HOST}:${opts.port}: address already in use`,
          err
        );
      }
      throw new McpServerStartError(
        'BIND_FAILED',
        `MCP server failed to bind to ${LOOPBACK_HOST}:${opts.port}: ${(err as Error).message}`,
        err
      );
    }

    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      // Should never happen with TCP listen; defensive cleanup.
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new McpServerStartError('BIND_FAILED', 'MCP server bound to a non-TCP address');
    }
    this.httpServer = server;
    this.boundPort = (addr as AddressInfo).port;
    return { port: this.boundPort };
  }

  /**
   * Gracefully stops the HTTP server and tears down every active transport.
   * Safe to call when not running (idempotent).
   */
  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    this.boundPort = null;
    this.tokenBuffer = null;
    this.mcpServerFactory = null;

    // Close all open sessions first so in-flight SSE streams shut down before
    // we kill the underlying socket. Close the transport AND its paired
    // McpServer so per-session subscriptions don't leak.
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(
      sessions.flatMap(({ transport, mcpServer }) => [transport.close(), mcpServer.close()])
    );

    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force-disconnect idle keep-alive connections so close() returns
      // promptly even if a client is holding the socket open.
      server.closeIdleConnections?.();
    });
  }

  isRunning(): boolean {
    return this.httpServer !== null;
  }

  getPort(): number | null {
    return this.boundPort;
  }

  // ── Request handling ────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS-rebinding protection: the Host header must match a loopback name
    // bound to the actual port we're listening on. This blocks browser-based
    // attacks where a malicious DNS record points at our loopback IP.
    if (!this.isHostHeaderAllowed(req.headers.host)) {
      this.respondJson(res, 421, {
        error: 'misdirected_request',
        message: 'Host header must be 127.0.0.1 or localhost on the bound port.',
      });
      return;
    }

    if (!this.isAuthorized(req.headers.authorization)) {
      // WWW-Authenticate signals Bearer scheme so clients can prompt.
      res.setHeader('WWW-Authenticate', 'Bearer realm="emdash-mcp"');
      this.respondJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const url = req.url ?? '/';
    if (!url.startsWith(MCP_ENDPOINT)) {
      this.respondJson(res, 404, { error: 'not_found' });
      return;
    }

    await this.routeMcp(req, res);
  }

  private isHostHeaderAllowed(host: string | undefined): boolean {
    if (!host || this.boundPort === null) return false;
    // The OS may surface IPv6 loopback as `[::1]`; we don't bind to ::1 (we
    // bind to 127.0.0.1 explicitly), so we don't need to accept it here.
    const allowed = new Set([`127.0.0.1:${this.boundPort}`, `localhost:${this.boundPort}`]);
    return allowed.has(host);
  }

  private isAuthorized(header: string | undefined): boolean {
    if (!header || !this.tokenBuffer) return false;
    // Header format: "Bearer <token>". Be strict — no other schemes.
    if (!header.startsWith('Bearer ')) return false;
    const presented = header.slice('Bearer '.length).trim();
    if (presented.length === 0) return false;
    const presentedBuf = Buffer.from(presented, 'utf8');
    // timingSafeEqual requires identical byte lengths; bail (still constant
    // time w.r.t. token bytes) if the lengths differ.
    if (presentedBuf.length !== this.tokenBuffer.length) return false;
    return timingSafeEqual(presentedBuf, this.tokenBuffer);
  }

  private async routeMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionHeader = req.headers[MCP_SESSION_HEADER];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.transport.handleRequest(req, res);
      return;
    }

    const factory = this.mcpServerFactory;
    if (!factory) {
      this.respondJson(res, 503, { error: 'mcp_server_not_ready' });
      return;
    }

    // Mint a brand-new McpServer for this session. The SDK forbids connecting
    // a single McpServer to more than one transport at a time, so each new
    // session gets its own; tool/resource registration is cheap.
    const sessionMcpServer = factory();

    // `onsessioninitialized` fires from inside `handleRequest` once the SDK
    // assigns a session id to the transport — that's the only point at which
    // `transport.sessionId` is guaranteed to be set, so it's the correct hook
    // for registering the session. The closures reach `transport` via a
    // one-element ref so we can build the SDK options object before the
    // transport itself exists.
    const transportRef: { current: StreamableHTTPServerTransport | null } = { current: null };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (initializedId) => {
        const t = transportRef.current;
        if (t) {
          this.sessions.set(initializedId, { transport: t, mcpServer: sessionMcpServer });
        }
      },
      onsessionclosed: (closedId) => {
        this.dropSession(closedId);
      },
    });
    transportRef.current = transport;

    const originalOnClose = transport.onclose;
    transport.onclose = () => {
      // Remove on any close (client disconnect, explicit close, etc.). The
      // SDK calls onsessionclosed too in many cases but this catches early
      // disconnects before a session id was ever assigned.
      if (transport.sessionId) {
        this.dropSession(transport.sessionId);
      } else {
        sessionMcpServer.close().catch((err) => {
          log.warn('[mcp-server] error closing per-session McpServer on early disconnect', err);
        });
      }
      originalOnClose?.();
    };

    try {
      await sessionMcpServer.connect(transport);
    } catch (err) {
      // Connect failure means the transport never became part of a session;
      // drop the brand-new McpServer so we don't leak it.
      await sessionMcpServer.close().catch(() => {});
      throw err;
    }

    await transport.handleRequest(req, res);
  }

  private dropSession(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.delete(sessionId);
    existing.transport.close().catch((err) => {
      log.warn('[mcp-server] error closing transport on session-closed', err);
    });
    existing.mcpServer.close().catch((err) => {
      log.warn('[mcp-server] error closing McpServer on session-closed', err);
    });
  }

  private respondJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return;
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(payload).toString());
    res.end(payload);
  }
}
