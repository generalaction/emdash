import { isAutomationQuery } from '@renderer/features/automations/automation-query-keys';
import {
  clearAutomationAgentWorking,
  updateAutomationAgentActivity,
  updateAutomationRunStatus,
} from '@renderer/features/automations/automation-run-status-store';
import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import type { Automation } from '@shared/automations/types';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  isAttentionNotification,
} from '@shared/events/agentEvents';
import {
  automationRunUpdatedChannel,
  automationsChangedChannel,
} from '@shared/events/automationEvents';

export function wireAutomationCacheInvalidation(): void {
  events.on(agentEventChannel, ({ event }) => {
    if (event.type === 'start') {
      updateAutomationAgentActivity(event.taskId, 'working');
      return;
    }

    if (event.type === 'notification') {
      const notificationType = event.payload.notificationType;
      if (!isAttentionNotification(notificationType)) return;
      updateAutomationAgentActivity(
        event.taskId,
        event.providerId === 'codex' && notificationType === 'idle_prompt'
          ? 'completed'
          : 'awaiting-input'
      );
      return;
    }

    if (event.type === 'stop') {
      updateAutomationAgentActivity(event.taskId, 'completed');
      return;
    }

    if (event.type === 'error') {
      updateAutomationAgentActivity(event.taskId, 'error');
    }
  });

  events.on(agentSessionExitedChannel, ({ taskId }) => {
    clearAutomationAgentWorking(taskId);
  });

  events.on(automationsChangedChannel, () => {
    void queryClient.invalidateQueries({
      predicate: (query) => isAutomationQuery(query.queryKey),
    });
  });

  events.on(automationRunUpdatedChannel, ({ automationId, runId, status, taskId, startedAt }) => {
    updateAutomationRunStatus(automationId, { runId, status, taskId });
    void queryClient.invalidateQueries({ queryKey: ['automations', 'runs', automationId] });
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'automations' && query.queryKey[1] === 'recent-runs',
    });
    if (status === 'success') {
      const lastRunAt = startedAt ?? Date.now();
      queryClient.setQueriesData<Automation[]>(
        {
          predicate: (query) => isAutomationQuery(query.queryKey),
        },
        (current) =>
          current?.map((automation) =>
            automation.id === automationId ? { ...automation, lastRunAt } : automation
          )
      );
    }
  });
}
