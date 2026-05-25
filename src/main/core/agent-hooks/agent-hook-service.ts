import { conversationEvents } from '@main/core/conversations/conversation-events';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { extractCodexProviderSessionId } from './codex-session-id';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';

class AgentHookService implements IInitializable, IDisposable {
  private server = new HookServer();

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      if (raw.type === 'session-start') {
        await this.persistCodexSessionStart(raw);
        return;
      }

      const event = await enrichEvent(raw);
      event.source = 'hook';
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      events.emit(agentEventChannel, { event, appFocused });
    });

    conversationEvents.on(
      'conversation:input-submitted',
      ({ projectId, taskId, conversationId, providerId }) => {
        const agentEvent: AgentEvent = {
          type: 'start',
          source: 'input',
          providerId,
          projectId,
          taskId,
          conversationId,
          timestamp: Date.now(),
          payload: {},
        };
        events.emit(agentEventChannel, { event: agentEvent, appFocused: isAppFocused() });

        telemetryService.capture('agent_run_started', {
          provider: providerId,
          project_id: projectId,
          task_id: taskId,
          conversation_id: conversationId,
        });

        const now = new Date().toISOString();
        void touchConversation(conversationId, now).then(() => {
          events.emit(conversationChangedChannel, {
            conversationId,
            taskId,
            projectId,
            changes: { lastInteractedAt: now },
          });
        });
      }
    );
  }

  dispose(): void {
    this.server.stop();
  }
  getPort(): number {
    return this.server.getPort();
  }
  getToken(): string {
    return this.server.getToken();
  }

  private async persistCodexSessionStart(raw: { ptyId: string; body: string }): Promise<void> {
    try {
      const event = await enrichEvent({ ...raw, type: 'session-start' });
      if (event.providerId !== 'codex') return;

      const body = raw.body ? (JSON.parse(raw.body) as Record<string, unknown>) : {};
      const providerSessionId = extractCodexProviderSessionId(body);
      if (!providerSessionId) return;

      const updated = await setProviderSessionId(event.conversationId, providerSessionId);
      if (!updated) return;

      events.emit(conversationChangedChannel, {
        conversationId: event.conversationId,
        taskId: event.taskId,
        projectId: event.projectId,
        changes: { providerSessionId },
      });
    } catch (error) {
      log.warn('AgentHookService: failed to persist Codex session id', {
        ptyId: raw.ptyId,
        error: String(error),
      });
    }
  }
}

export const agentHookService = new AgentHookService();
