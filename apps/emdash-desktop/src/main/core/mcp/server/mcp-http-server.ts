import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { app } from 'electron';
import { log } from '@main/lib/logger';
import { buildEmdashMcpServer } from './register-tools';

/** 8212 = U+2014 EM DASH. Override with EMDASH_MCP_PORT. */
const DEFAULT_PORT = 8212;
const MAX_BODY_BYTES = 4_000_000;
const TOKEN_FILE = 'mcp-server-token';

// Loopback only: requests are rejected unless both the Host header and, when a
// browser sends one, the Origin header resolve to these hostnames. This blocks
// DNS-rebinding attacks where a web page tricks the browser into hitting the
// local port with an attacker-controlled Host/Origin.
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

function tokensMatch(expected: string, presented: string): boolean {
  // Hash before comparing so timingSafeEqual gets equal-length buffers.
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}

/**
 * Local HTTP server exposing emdash as an MCP server (Streamable HTTP transport,
 * stateless mode). Binds to 127.0.0.1 and requires a bearer token persisted in
 * the app's userData directory.
 */
type ParsedBody = { kind: 'ok'; body: unknown } | { kind: 'invalid' } | { kind: 'too-large' };

export class McpHttpServer {
  private server: http.Server | null = null;
  private startPromise: Promise<void> | null = null;
  private port = 0;
  private token = '';

  /** `portOverride` (0 = ephemeral) bypasses EMDASH_MCP_PORT/default resolution; for tests. */
  constructor(private readonly portOverride?: number) {}

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
    this.token = await this.loadOrCreateToken();
    const envPort = Number(process.env.EMDASH_MCP_PORT);
    const port =
      this.portOverride ?? (Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        log.error('McpHttpServer: request handler error', { error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          const address = server.address();
          this.port = typeof address === 'object' && address ? address.port : port;
          resolve();
        });
      });
    } catch (error) {
      // Reset fully so getConnectionInfo() reports not-running instead of a
      // port-0 URL that self-registration would write into agent configs.
      server.close();
      this.server = null;
      this.port = 0;
      throw error;
    }

    // Without a listener, a post-startup server 'error' event would crash the
    // main process (unhandled EventEmitter error).
    server.on('error', (error) => {
      log.error('McpHttpServer: server error', { error: String(error) });
    });

    log.info(`McpHttpServer: listening at ${this.getUrl()}`);
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
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  /** Connection details for registering emdash in agent configs; null when not running. */
  getConnectionInfo(): { url: string; token: string } | null {
    // `this.server` is assigned before listen() resolves; the port check keeps
    // a caller in that window from seeing a port-0 URL.
    if (!this.server || this.port === 0) return null;
    return { url: this.getUrl(), token: this.token };
  }

  private async loadOrCreateToken(): Promise<string> {
    const tokenPath = path.join(app.getPath('userData'), TOKEN_FILE);
    try {
      const existing = (await fs.readFile(tokenPath, 'utf8')).trim();
      if (existing) return existing;
    } catch {
      // Missing or unreadable — generate a fresh token below.
    }
    const token = randomBytes(32).toString('hex');
    // 0o600 restricts access on POSIX only; on Windows the file inherits the
    // userData directory ACL (per-user), which is the best Node's fs offers.
    await fs.writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
    return token;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    const hostName = hostnameOf(req.headers.host);
    if (!hostName || !ALLOWED_HOSTNAMES.has(hostName)) {
      log.warn('McpHttpServer: rejected request with non-local Host header');
      res.writeHead(403).end();
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const originHost = hostnameOf(origin);
      if (!originHost || !ALLOWED_HOSTNAMES.has(originHost)) {
        log.warn('McpHttpServer: rejected request with non-local Origin header');
        res.writeHead(403).end();
        return;
      }
    }

    const auth = req.headers.authorization ?? '';
    // The auth scheme is case-insensitive (RFC 7235), so accept "bearer" etc.
    const presented = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? '';
    if (!presented || !tokensMatch(this.token, presented)) {
      log.warn('McpHttpServer: rejected request with missing or invalid bearer token');
      res.writeHead(401).end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    const parsed = await this.readBody(req);
    if (parsed.kind === 'too-large') {
      // Respond before dropping the connection so the client sees a clean 413
      // instead of a connection reset mid-upload.
      res.writeHead(413, { Connection: 'close' }).end(() => req.destroy());
      return;
    }
    if (parsed.kind === 'invalid') {
      res.writeHead(400).end();
      return;
    }
    const body = parsed.body;

    // Stateless mode: a fresh server + transport per request, torn down when the
    // response closes. Avoids session bookkeeping for this local, single-user server.
    const mcpServer = buildEmdashMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private readBody(req: http.IncomingMessage): Promise<ParsedBody> {
    return new Promise((resolve) => {
      // Collect raw buffers and decode once: per-chunk toString() would corrupt
      // multibyte UTF-8 split across chunk boundaries, and the size cap must
      // count bytes, not UTF-16 code units.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          // Stop consuming but leave the socket alive so the caller can still
          // write a 413 response; the caller drops the connection afterwards.
          req.removeAllListeners('data');
          req.pause();
          resolve({ kind: 'too-large' });
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
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

export const mcpHttpServer = new McpHttpServer();
