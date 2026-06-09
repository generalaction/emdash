import { eq } from 'drizzle-orm';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  isAttentionNotification,
  type AgentEvent,
  type AgentStatus,
} from '@shared/core/agents/agentEvents';
import {
  conversationAgentStatusChangedChannel,
  conversationChangedChannel,
} from '@shared/core/conversations/conversationEvents';
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

function determineSoundEvent(
  event: AgentEvent,
  status: AgentStatus
): 'needs_attention' | 'task_complete' | undefined {
  if (status === 'awaiting-input') return 'needs_attention';
  if (status === 'completed' && event.type === 'stop') return 'task_complete';
  if (
    status === 'completed' &&
    event.type === 'notification' &&
    event.payload.notificationType === 'idle_prompt' &&
    (event.providerId === 'codex' || event.providerId === 'amp')
  ) {
    return 'task_complete';
  }
  return undefined;
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

    // Persist agent status to DB and emit simplified IPC for renderer.
    this.on('agent:event', async (event) => {
      const status = deriveAgentStatus(event);
      if (!status) return;
      const seen = status === 'idle' || status === 'working' ? 1 : 0;

      await db
        .update(conversations)
        .set({ agentStatus: status, agentStatusSeen: seen })
        .where(eq(conversations.id, event.conversationId));

      events.emit(conversationAgentStatusChangedChannel, {
        conversationId: event.conversationId,
        taskId: event.taskId,
        projectId: event.projectId,
        status,
        seen: seen === 1,
        soundEvent: determineSoundEvent(event, status),
      });
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
