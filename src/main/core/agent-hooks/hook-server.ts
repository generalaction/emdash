import crypto from 'node:crypto';
import http from 'node:http';
import { log } from '@main/lib/logger';

export interface RawHookRequest {
  ptyId: string;
  type: string;
  body: string;
}

export type HookHandler = (raw: RawHookRequest) => Promise<void>;

/** Generic handler for routes other than POST /hook. Receives parsed URL + raw request. */
export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
) => Promise<void> | void;

interface RouteEntry {
  method: string;
  /** Matched against `url.pathname` exactly. */
  pathname: string;
  handler: RouteHandler;
}

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private readonly routes: RouteEntry[] = [];

  /**
   * Register an additional route (e.g. GET /coord/siblings).
   * All routes share the same `X-Emdash-Token` auth as POST /hook.
   * Safe to call before or after `start()`.
   */
  addRoute(method: string, pathname: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), pathname, handler });
  }

  async start(handler: HookHandler): Promise<void> {
    if (this.server) return;
    this.token = crypto.randomUUID();

    this.server = http.createServer((req, res) => {
      if (req.headers['x-emdash-token'] !== this.token) {
        log.warn('HookServer: rejected request with invalid token');
        res.writeHead(403);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = (req.method ?? '').toUpperCase();

      // POST /hook keeps its custom flow because it must drain the request body.
      if (method === 'POST' && url.pathname === '/hook') {
        this.handleHookPost(req, res, handler);
        return;
      }

      const route = this.routes.find((r) => r.method === method && r.pathname === url.pathname);
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }

      Promise.resolve(route.handler(req, res, url)).catch((err) => {
        log.warn('HookServer: route handler error', {
          pathname: url.pathname,
          error: String(err),
        });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        log.info('HookServer: started', { port: this.port });
        resolve();
      });
      this.server!.on('error', (err) => {
        log.error('HookServer: failed to start', { error: String(err) });
        reject(err);
      });
    });
  }

  private handleHookPost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: HookHandler
  ): void {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        req.destroy();
      }
    });

    req.on('end', () => {
      const ptyId = String(req.headers['x-emdash-pty-id'] || '');
      const type = String(req.headers['x-emdash-event-type'] || '');
      if (!ptyId || !type) {
        log.warn('HookServer: malformed request — missing ptyId or type headers');
        res.writeHead(400);
        res.end();
        return;
      }
      handler({ ptyId, type, body })
        .then(() => {
          res.writeHead(200);
          res.end();
        })
        .catch((err) => {
          log.warn('HookServer: handler error', { error: String(err) });
          res.writeHead(500);
          res.end();
        });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }
  getPort(): number {
    return this.port;
  }
  getToken(): string {
    return this.token;
  }
}
