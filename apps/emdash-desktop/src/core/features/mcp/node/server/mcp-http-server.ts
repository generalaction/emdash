import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { Logger } from '@emdash/shared/logger';
import type { McpServer as McpSdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EMDASH_MCP_PATH } from '@core/primitives/mcp/api';

/** 8212 = U+2014 EM DASH. Override with EMDASH_MCP_PORT. */
export const DEFAULT_MCP_PORT = 8212;
/**
 * How many ports past the default to try when it is taken, so a second Emdash
 * (canary beside prod) or an unrelated squatter does not leave the server down.
 * An explicit EMDASH_MCP_PORT is taken literally and never scanned past.
 */
const PORT_SCAN_ATTEMPTS = 10;
const MAX_BODY_BYTES = 4_000_000;

// Loopback only: requests are rejected unless both the Host header and, when a
// browser sends one, the Origin header resolve to these hostnames. This blocks
// DNS-rebinding attacks where a web page tricks the browser into hitting the
// local port with an attacker-controlled Host/Origin.
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export type McpConnectionInfo = { url: string; token: string };

export type McpHttpServerOptions = Readonly<{
  /** Absolute path of the file holding the bearer token, created on first start. */
  tokenFilePath: string;
  logger: Logger;
  /** Builds a fresh MCP server per request (stateless transport mode). */
  buildServer: () => McpSdkServer;
  /** `0` binds an ephemeral port; bypasses EMDASH_MCP_PORT/default resolution. */
  portOverride?: number;
}>;

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EADDRINUSE';
}

function tokensMatch(expected: string, presented: string): boolean {
  // Hash before comparing so timingSafeEqual gets equal-length buffers.
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}

type ParsedBody = { kind: 'ok'; body: unknown } | { kind: 'invalid' } | { kind: 'too-large' };

/**
 * Local HTTP server exposing Emdash as an MCP server (Streamable HTTP transport,
 * stateless mode). Binds to 127.0.0.1 and requires a bearer token persisted next
 * to the app database.
 */
export class McpHttpServer {
  private server: http.Server | null = null;
  private startPromise: Promise<void> | null = null;
  private port = 0;
  private token = '';

  constructor(private readonly options: McpHttpServerOptions) {}

  async start(): Promise<void> {
    if (this.server) return;
    // Share one in-flight start: a concurrent second call would otherwise race
    // token loading and double-listen, and must not resolve before listen does.
    this.startPromise ??= this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const { logger } = this.options;
    this.token = await this.loadOrCreateToken();

    const candidates = this.candidatePorts();
    let lastError: unknown;
    for (const [index, candidate] of candidates.entries()) {
      const server = this.createServer();
      try {
        await this.listen(server, candidate);
      } catch (error) {
        lastError = error;
        // Reset fully so getConnectionInfo() reports not-running instead of a
        // port-0 URL that self-registration would write into agent configs.
        server.close();
        this.server = null;
        this.port = 0;
        if (isAddressInUse(error) && index < candidates.length - 1) {
          logger.info(`McpHttpServer: port ${candidate} is in use, trying the next one`);
          continue;
        }
        throw error;
      }

      // Without a listener, a post-startup server 'error' event would crash the
      // main process (unhandled EventEmitter error).
      server.on('error', (error) => {
        logger.error('McpHttpServer: server error', { error: String(error) });
      });
      logger.info(`McpHttpServer: listening at ${this.getUrl()}`);
      return;
    }
    throw lastError;
  }

  /**
   * The one requested port, or the default plus a short scan. `portOverride`
   * (tests) and EMDASH_MCP_PORT are explicit instructions, so they are not
   * scanned past.
   */
  private candidatePorts(): number[] {
    if (this.options.portOverride !== undefined) return [this.options.portOverride];
    const envPort = Number(process.env.EMDASH_MCP_PORT);
    if (Number.isInteger(envPort) && envPort > 0) return [envPort];
    return Array.from({ length: PORT_SCAN_ATTEMPTS }, (_, offset) => DEFAULT_MCP_PORT + offset);
  }

  private createServer(): http.Server {
    const { logger } = this.options;
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        logger.error('McpHttpServer: request handler error', { error: String(error) });
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    this.server = server;
    return server;
  }

  private listen(server: http.Server, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const address = server.address();
        this.port = typeof address === 'object' && address ? address.port : port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.port = 0;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.port}${EMDASH_MCP_PATH}`;
  }

  /** Connection details for registering Emdash in agent configs; null when not running. */
  getConnectionInfo(): McpConnectionInfo | null {
    // `this.server` is assigned before listen() resolves; the port check keeps
    // a caller in that window from seeing a port-0 URL.
    if (!this.server || this.port === 0) return null;
    return { url: this.getUrl(), token: this.token };
  }

  private async loadOrCreateToken(): Promise<string> {
    const tokenPath = this.options.tokenFilePath;
    try {
      const existing = (await fs.readFile(tokenPath, 'utf8')).trim();
      if (existing) return existing;
    } catch {
      // Missing or unreadable — generate a fresh token below.
    }
    const token = randomBytes(32).toString('hex');
    // 0o600 restricts access on POSIX only; on Windows the file inherits the
    // parent directory ACL (per-user), which is the best Node's fs offers.
    await fs.writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
    return token;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { logger } = this.options;
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== EMDASH_MCP_PATH) {
      res.writeHead(404).end();
      return;
    }

    const hostName = hostnameOf(req.headers.host);
    if (!hostName || !ALLOWED_HOSTNAMES.has(hostName)) {
      logger.warn('McpHttpServer: rejected request with non-local Host header');
      res.writeHead(403).end();
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const originHost = hostnameOf(origin);
      if (!originHost || !ALLOWED_HOSTNAMES.has(originHost)) {
        logger.warn('McpHttpServer: rejected request with non-local Origin header');
        res.writeHead(403).end();
        return;
      }
    }

    const auth = req.headers.authorization ?? '';
    // The auth scheme is case-insensitive (RFC 7235), so accept "bearer" etc.
    const presented = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? '';
    if (!presented || !tokensMatch(this.token, presented)) {
      logger.warn('McpHttpServer: rejected request with missing or invalid bearer token');
      res.writeHead(401).end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    const parsed = await this.readBody(req);
    if (parsed.kind === 'too-large') {
      res.writeHead(413, { Connection: 'close' }).end();
      return;
    }
    if (parsed.kind === 'invalid') {
      res.writeHead(400).end();
      return;
    }

    // Stateless mode: a fresh server + transport per request, torn down when the
    // response closes. Avoids session bookkeeping for this local, single-user server.
    const mcpServer = this.options.buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsed.body);
  }

  private readBody(req: http.IncomingMessage): Promise<ParsedBody> {
    return new Promise((resolve) => {
      // Collect raw buffers and decode once: per-chunk toString() would corrupt
      // multibyte UTF-8 split across chunk boundaries, and the size cap must
      // count bytes, not UTF-16 code units.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          // Release what was buffered and discard the rest of the upload, but
          // keep reading it: answering before the client has finished writing
          // shows up as a connection reset instead of a clean 413.
          tooLarge = true;
          chunks.length = 0;
          req.removeAllListeners('data');
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (tooLarge) {
          resolve({ kind: 'too-large' });
          return;
        }
        try {
          resolve({ kind: 'ok', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          resolve({ kind: 'invalid' });
        }
      });
      req.on('error', () => resolve({ kind: 'invalid' }));
    });
  }
}
