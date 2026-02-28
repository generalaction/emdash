import http from 'http';
import crypto from 'crypto';
import { BrowserWindow, Notification } from 'electron';
import { log } from '../lib/logger';
import { parsePtyId } from '@shared/ptyId';
import { getProvider } from '@shared/providers/registry';
import type { ProviderId } from '@shared/providers/registry';
import type { AgentEvent } from '@shared/agentEvents';
import { getAppSettings } from '../settings';

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
          // ptyId and event type come from headers (not body) so the
          // payload can be piped from stdin via `curl -d @-` without
          // any shell interpolation of its contents.
          const ptyId = String(req.headers['x-emdash-pty-id'] || '');
          const type = String(req.headers['x-emdash-event-type'] || '');

          if (!ptyId || !type) {
            log.warn('AgentEventService: malformed request — missing ptyId or type headers');
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

          // Body is the raw Claude Code hook payload JSON
          const raw = body ? JSON.parse(body) : {};

          // Normalize snake_case fields from provider hooks to camelCase
          const normalizedPayload = {
            ...raw,
            notificationType: raw.notification_type ?? raw.notificationType,
            lastAssistantMessage: raw.last_assistant_message ?? raw.lastAssistantMessage,
          };
          delete normalizedPayload.notification_type;
          delete normalizedPayload.last_assistant_message;

          const event: AgentEvent = {
            type: type as AgentEvent['type'],
            ptyId,
            taskId: parsed.suffix,
            providerId: parsed.providerId,
            timestamp: Date.now(),
            payload: normalizedPayload,
          };

          const windows = BrowserWindow.getAllWindows();
          const appFocused = windows.some((w) => !w.isDestroyed() && w.isFocused());

          // Show OS notification banner when appropriate
          this.maybeShowOsNotification(event, appFocused);

          for (const win of windows) {
            try {
              if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send('agent:event', event, { appFocused });
              }
            } catch {
              // Window may have been destroyed between check and send
            }
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

  private maybeShowOsNotification(event: AgentEvent, appFocused: boolean): void {
    try {
      const settings = getAppSettings();
      if (!settings.notifications?.enabled) return;
      if (!settings.notifications?.osNotifications) return;
      if (appFocused) return;
      if (!Notification.isSupported()) return;

      const providerName = getProvider(event.providerId as ProviderId)?.name ?? event.providerId;

      if (event.type === 'stop') {
        const notification = new Notification({
          title: `${providerName} Task Complete`,
          silent: true,
        });
        notification.show();
      } else if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
          const notification = new Notification({
            title: `${providerName} Needs Attention`,
            silent: true,
          });
          notification.show();
        }
      }
    } catch (error) {
      log.warn('AgentEventService: failed to show OS notification', { error: String(error) });
    }
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
