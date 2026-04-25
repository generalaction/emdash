import crypto from 'node:crypto';
import http from 'node:http';
import { log } from '@main/lib/logger';

export interface RawHookRequest {
  ptyId: string;
  type: string;
  body: string;
}

export type HookHandler = (raw: RawHookRequest) => Promise<void>;

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';

  async start(handler: HookHandler): Promise<void> {
    if (this.server) return;
    this.token = crypto.randomUUID();

    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.headers['x-emdash-token'] !== this.token) {
        log.warn('HookServer: rejected request with invalid token');
        res.writeHead(403);
        res.end();
        return;
      }

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
