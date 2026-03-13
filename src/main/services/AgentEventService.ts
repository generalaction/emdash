import crypto from 'node:crypto';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { BrowserWindow, Notification } from 'electron';
import { getProvider, type ProviderId } from '@shared/agent-provider-registry';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { notificationFocusTaskChannel } from '@shared/events/appEvents';
import { parsePtyId } from '@shared/ptyId';
import { getMainWindow } from '@main/app/window';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

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

      req.on('end', async () => {
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

          const convRows = await db
            .select({ taskId: conversations.taskId })
            .from(conversations)
            .where(eq(conversations.id, parsed.conversationId))
            .limit(1);
          const taskId = convRows[0]?.taskId ?? parsed.conversationId;

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
            conversationId: parsed.conversationId,
            taskId,
            providerId: parsed.providerId,
            timestamp: Date.now(),
            payload: normalizedPayload,
          };

          const windows = BrowserWindow.getAllWindows();
          const appFocused = windows.some((w) => !w.isDestroyed() && w.isFocused());

          await this.maybeShowOsNotification(event, appFocused);

          events.emit(agentEventChannel, { event, appFocused });

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

  private async maybeShowOsNotification(event: AgentEvent, appFocused: boolean): Promise<void> {
    try {
      const notifications = await appSettingsService.get('notifications');
      if (!notifications?.enabled) return;
      if (!notifications?.osNotifications) return;
      if (appFocused) return;
      if (!Notification.isSupported()) return;

      const providerName = getProvider(event.providerId as ProviderId)?.name ?? event.providerId;

      let taskName: string | null = null;
      if (event.taskId) {
        const taskRows = await db
          .select({ name: tasks.name })
          .from(tasks)
          .where(eq(tasks.id, event.taskId))
          .limit(1);
        if (taskRows[0]?.name) taskName = taskRows[0].name;
      }

      const titleSuffix = taskName ? ` — ${taskName}` : '';

      const addClickHandler = (notification: Notification) => {
        notification.on('click', () => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            if (event.taskId) {
              events.emit(notificationFocusTaskChannel, { taskId: event.taskId });
            }
          }
        });
      };

      if (event.type === 'stop') {
        const notification = new Notification({
          title: `${providerName}${titleSuffix}`,
          body: 'Your agent has finished working',
          silent: true,
        });
        addClickHandler(notification);
        notification.show();
      } else if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
          const notification = new Notification({
            title: `${providerName}${titleSuffix}`,
            body: 'Your agent is waiting for input',
            silent: true,
          });
          addClickHandler(notification);
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
