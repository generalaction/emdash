import { eq } from 'drizzle-orm';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { saveProviderSessionId } from '@main/core/conversations/save-provider-session-id';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { isValidProviderSessionId } from '@shared/core/agents/agent-provider-registry';
import {
  agentSessionExitedChannel,
  isAttentionNotification,
  type AgentEvent,
  type AgentStatus,
} from '@shared/core/agents/agentEvents';
import {
  conversationAgentStatusChangedChannel,
  conversationChangedChannel,
} from '@shared/core/conversations/conversationEvents';
import { parseHookEvent } from './event-enricher';
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
  return undefined;
}

async function handleSessionEvent(
  ctx: { conversationId: string; taskId: string; projectId: string; providerId: string },
  providerSessionId: string
): Promise<void> {
  if (!isValidProviderSessionId(ctx.providerId, providerSessionId)) return;

  if (ctx.providerId === 'droid') {
    await saveProviderSessionId(ctx.conversationId, providerSessionId);
    return;
  }

  const updated = await setProviderSessionId(ctx.conversationId, providerSessionId);
  if (!updated) return;

  events.emit(conversationChangedChannel, {
    conversationId: ctx.conversationId,
    taskId: ctx.taskId,
    projectId: ctx.projectId,
    changes: { providerSessionId },
  });
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
      let parsed;
      try {
        parsed = await parseHookEvent(raw);
      } catch (error) {
        log.warn('AgentHookService: failed to parse hook event', {
          ptyId: raw.ptyId,
          type: raw.type,
          error: String(error),
        });
        return;
      }

      if (parsed.kind === 'ignore') return;

      if (parsed.kind === 'session') {
        await handleSessionEvent(parsed.ctx, parsed.providerSessionId).catch((error) => {
          log.warn('AgentHookService: failed to persist session id', {
            ptyId: raw.ptyId,
            error: String(error),
          });
        });
        return;
      }

      const event = parsed.event;
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      this.emitAgentEvent(event, appFocused);
    });

    conversationEvents.on(
      'conversation:input-submitted',
      ({ projectId, taskId, conversationId, providerId }) => {
        // Only synthesise a 'start' event when the plugin does not supply its own
        // start hook (e.g. UserPromptSubmit). Providers with start-capable hooks
        // get 'working' from the real hook event instead.
        const plugin = getPlugin(providerId);
        const hooksDesc = plugin?.capabilities.hooks;
        const supportedEvents =
          hooksDesc && hooksDesc.kind !== 'none' ? hooksDesc.supportedEvents : [];
        const hasStartHook = supportedEvents.includes('start');

        if (!hasStartHook) {
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
        }

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

    // Reset a stuck 'working' status to 'idle' when the agent PTY exits.
    // This handles the case where the user interrupts/kills the agent before
    // a 'stop' or 'error' hook fires.
    events.on(agentSessionExitedChannel, ({ conversationId, taskId }) => {
      void (async () => {
        try {
          const [row] = await db
            .select({ agentStatus: conversations.agentStatus, projectId: conversations.projectId })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

          if (!row || row.agentStatus !== 'working') return;

          await db
            .update(conversations)
            .set({ agentStatus: 'idle', agentStatusSeen: 1 })
            .where(eq(conversations.id, conversationId));

          events.emit(conversationAgentStatusChangedChannel, {
            conversationId,
            taskId,
            projectId: row.projectId,
            status: 'idle',
            seen: true,
            soundEvent: undefined,
          });
        } catch (error) {
          log.warn('AgentHookService: failed to reset stuck working status on exit', {
            conversationId,
            error: String(error),
          });
        }
      })();
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
