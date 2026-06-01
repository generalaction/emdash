import { taskWasCreatedByAutomationRun } from '@main/core/automations/repo';
import { taskManager } from '@main/core/tasks/task-manager';
import { log } from '@main/lib/logger';
import type { AgentEvent } from '@shared/events/agentEvents';

export async function stopAutomationSessionAfterDone(event: AgentEvent): Promise<void> {
  if (event.type !== 'stop') return;

  try {
    if (!(await taskWasCreatedByAutomationRun(event.taskId))) return;

    const task = taskManager.getTask(event.taskId);
    if (!task) return;

    await task.conversations.stopSession(event.conversationId);
  } catch (error) {
    log.warn('agent-hooks: failed to stop completed automation PTY', {
      taskId: event.taskId,
      conversationId: event.conversationId,
      error: String(error),
    });
  }
}
