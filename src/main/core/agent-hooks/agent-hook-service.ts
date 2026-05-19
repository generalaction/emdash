import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { conversationRenamedChannel, taskRenamedChannel } from '@shared/events/taskEvents';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { telemetryService } from '@main/lib/telemetry';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';
import { handleConversationRename, handleTaskRename } from './rename-handler';

class AgentHookService implements IInitializable, IDisposable {
  private server = new HookServer();

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      if (raw.type === 'rename-conversation') {
        const result = await handleConversationRename(raw);
        events.emit(conversationRenamedChannel, {
          conversationId: result.conversationId,
          taskId: result.taskId,
          projectId: result.projectId,
          title: result.title,
        });
        return;
      }
      if (raw.type === 'rename-task') {
        const result = await handleTaskRename(raw);
        events.emit(taskRenamedChannel, {
          taskId: result.taskId,
          projectId: result.projectId,
          name: result.name,
        });
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
}

export const agentHookService = new AgentHookService();
