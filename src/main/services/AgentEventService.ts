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

          // Normalize snake_case fields from provider hooks to camelCase
          const raw = payload || {};
          const normalizedPayload = {
            ...raw,
            notificationType: raw.notification_type ?? raw.notificationType,
            lastAssistantMessage: raw.last_assistant_message ?? raw.lastAssistantMessage,
          };
          delete normalizedPayload.notification_type;
          delete normalizedPayload.last_assistant_message;

          const event: AgentEvent = {
            type,
            ptyId,
            taskId: parsed.suffix,
            providerId: parsed.providerId,
            timestamp: Date.now(),
            payload: normalizedPayload,
          };

          const windows = BrowserWindow.getAllWindows();
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
