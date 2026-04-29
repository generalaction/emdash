import type { AutomationEvent } from '@shared/automations/events';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { taskCreatedChannel, taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { hasAnyEnabledEventAutomation } from './event-cache';
import { dispatchEvent } from './eventDispatcher';

type TaskCompletionKind = 'task.completed' | 'task.failed';

const TASK_STATUS_TO_EVENT: Record<string, TaskCompletionKind> = {
  completed: 'task.completed',
  failed: 'task.failed',
};

let started = false;
const unsubscribers: Array<() => void> = [];

function emit(event: AutomationEvent): void {
  void hasAnyEnabledEventAutomation().then((hasAny) => {
    if (!hasAny) return;
    return dispatchEvent(event).catch((error) => {
      log.error('automations.internalBridge: dispatch failed', {
        kind: event.kind,
        error: String(error),
      });
    });
  });
}

export function startInternalEventBridge(): void {
  if (started) return;
  started = true;

  unsubscribers.push(
    events.on(taskCreatedChannel, ({ task }) => {
      emit({
        kind: 'task.created',
        provider: 'internal',
        projectId: task.projectId,
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          name: task.name,
          status: task.status,
        },
        occurredAt: Date.now(),
      });
    })
  );

  unsubscribers.push(
    events.on(taskStatusUpdatedChannel, (data) => {
      const kind = TASK_STATUS_TO_EVENT[data.status];
      if (!kind) return;
      emit({
        kind,
        provider: 'internal',
        projectId: data.projectId,
        payload: {
          taskId: data.taskId,
          projectId: data.projectId,
          status: data.status,
        },
        occurredAt: Date.now(),
      });
    })
  );

  unsubscribers.push(
    events.on(agentSessionExitedChannel, (data) => {
      emit({
        kind: 'agent.session_exited',
        provider: 'internal',
        projectId: data.projectId,
        payload: {
          taskId: data.taskId,
          projectId: data.projectId,
          conversationId: data.conversationId,
          exitCode: data.exitCode,
        },
        occurredAt: Date.now(),
      });
    })
  );

  log.info('automations.internalBridge: started');
}

export function stopInternalEventBridge(): void {
  for (const unsub of unsubscribers) unsub();
  unsubscribers.length = 0;
  started = false;
}
