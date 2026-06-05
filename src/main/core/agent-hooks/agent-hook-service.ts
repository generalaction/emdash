import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  agentEventChannel,
  isAttentionNotification,
  type AgentEvent,
  type AgentStatus,
} from '@shared/events/agentEvents';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { stopAutomationSessionAfterDone } from './automation-pty-cleanup';
import { handleCodexSessionStartHook } from './codex-session-start';
import { enrichEvent } from './event-enricher';
import { handleProviderSessionHook } from './handle-provider-session-hook';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';

export type AgentHookServiceHooks = {
  'agent:event': (event: AgentEvent, appFocused: boolean) => void | Promise<void>;
};

function deriveAgentStatus(event: AgentEvent): AgentStatus | null {
  if (event.type === 'start') return 'working';
  if (event.type === 'stop') return 'completed';
  if (event.type === 'error') return 'error';
  if (event.type === 'notification') {
    const nt = event.payload.notificationType;
    if (!nt) return null;
    // idle_prompt for codex/amp signals done
    if (nt === 'idle_prompt' && (event.providerId === 'codex' || event.providerId === 'amp')) {
      return 'completed';
    }
    if (isAttentionNotification(nt)) return 'awaiting-input';
  }
  return null;
}

class AgentHookService implements IInitializable, IDisposable, Hookable<AgentHookServiceHooks> {
  private server = new HookServer();
  private readonly _hooks = new HookCore<AgentHookServiceHooks>((name, e) =>
    log.error(`AgentHookService: ${String(name)} hook error`, e)
  );

  on<K extends keyof AgentHookServiceHooks>(name: K, handler: AgentHookServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  emitAgentEvent(event: AgentEvent, appFocused: boolean): void {
    events.emit(agentEventChannel, { event, appFocused });
    this._hooks.callHookBackground('agent:event', event, appFocused);
  }

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      if (raw.type === 'session') {
        await handleProviderSessionHook(raw);
        return;
      }

      if (raw.type === 'session-start') {
        await handleCodexSessionStartHook(raw);
        return;
      }

      const event = await enrichEvent(raw);
      event.source = 'hook';
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      this.emitAgentEvent(event, appFocused);
      void stopAutomationSessionAfterDone(event);
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
        this.emitAgentEvent(agentEvent, isAppFocused());

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

    // Persist agent status to DB on every agent event.
    this.on('agent:event', async (event) => {
      const status = deriveAgentStatus(event);
      if (!status) return;
      const seen = status === 'idle' || status === 'working' ? 1 : 0;
      await db
        .update(conversations)
        .set({ agentStatus: status, agentStatusSeen: seen })
        .where(eq(conversations.id, event.conversationId));
    });
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
}

export const agentHookService = new AgentHookService();
