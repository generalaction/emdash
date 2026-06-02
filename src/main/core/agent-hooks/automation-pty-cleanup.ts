import { taskWasCreatedByAutomationRun } from '@main/core/automations/repo';
import { taskManager } from '@main/core/tasks/task-manager';
import { log } from '@main/lib/logger';
import type { AgentEvent } from '@shared/events/agentEvents';

const stoppingAutomationSessions = new Set<string>();

export async function stopAutomationSessionAfterDone(event: AgentEvent): Promise<void> {
  if (event.type !== 'stop') return;

  if (stoppingAutomationSessions.has(event.conversationId)) return;
  stoppingAutomationSessions.add(event.conversationId);

  try {
    if (!(await taskWasCreatedByAutomationRun(event.taskId))) {
      stoppingAutomationSessions.delete(event.conversationId);
      return;
    }

    const task = taskManager.getTask(event.taskId);
    if (!task) {
      stoppingAutomationSessions.delete(event.conversationId);
      return;
    }

    await task.conversations.stopSession(event.conversationId);
    stoppingAutomationSessions.delete(event.conversationId);
  } catch (error) {
    stoppingAutomationSessions.delete(event.conversationId);
    log.warn('agent-hooks: failed to stop completed automation PTY', {
      taskId: event.taskId,
      conversationId: event.conversationId,
      error: String(error),
    });
  }
}
