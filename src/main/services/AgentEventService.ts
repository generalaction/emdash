import http from 'http';
import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { parsePtyId } from '@shared/ptyId';
import type { AgentEvent } from '@shared/agentEvents';

class AgentEventService {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';

  async start(): Promise<void> {
    if (this.server) return;

    this.token = crypto.randomUUID();

    this.server = http.createServer((req, res) => {
      log.info('AgentEventService: incoming request', {
        method: req.method,
        url: req.url,
      });

      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
        res.end();
        return;
      }

      const authToken = req.headers['x-emdash-token'];
      if (authToken !== this.token) {
        log.warn('AgentEventService: rejected request with invalid token');
        res.writeHead(403);
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        // Guard against oversized payloads
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });

      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const { ptyId, type, payload } = data;

          if (!ptyId || !type) {
            log.warn('AgentEventService: malformed request — missing ptyId or type');
            res.writeHead(400);
            res.end();
            return;
          }

          const parsed = parsePtyId(ptyId);
          if (!parsed) {
            log.warn('AgentEventService: unrecognised ptyId', { ptyId });
            res.writeHead(400);
            res.end();
            return;
          }

          // Claude Code sends snake_case (notification_type, last_assistant_message).
          // Normalize to camelCase for our internal types.
          const raw = payload || {};
          const event: AgentEvent = {
            type,
            ptyId,
            taskId: parsed.suffix,
            providerId: parsed.providerId,
            timestamp: Date.now(),
            payload: {
              notificationType: raw.notification_type || raw.notificationType,
              title: raw.title,
              message: raw.message,
              lastAssistantMessage: raw.last_assistant_message || raw.lastAssistantMessage,
            },
          };

          log.info('AgentEventService: received hook event', {
            type: event.type,
            ptyId: event.ptyId,
            providerId: event.providerId,
            notificationType: event.payload.notificationType,
          });

          const windows = BrowserWindow.getAllWindows();
          log.info('AgentEventService: broadcasting to windows', { count: windows.length });
          for (const win of windows) {
            win.webContents.send('agent:event', event);
          }

          res.writeHead(200);
          res.end();
        } catch (err) {
          log.warn('AgentEventService: failed to parse request body', { error: String(err) });
          res.writeHead(400);
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
        log.info('AgentEventService: started', { port: this.port });
        resolve();
      });
      this.server!.on('error', (err) => {
        log.error('AgentEventService: failed to start', { error: String(err) });
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

export const agentEventService = new AgentEventService();
