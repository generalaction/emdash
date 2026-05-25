import { isAutomationQuery } from '@renderer/features/automations/automation-query-keys';
import { updateAutomationRunStatus } from '@renderer/features/automations/automation-run-status-store';
import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import type { Automation } from '@shared/automations/types';
import {
  automationRunUpdatedChannel,
  automationsChangedChannel,
} from '@shared/events/automationEvents';

export function wireAutomationCacheInvalidation(): void {
  events.on(automationsChangedChannel, () => {
    void queryClient.invalidateQueries({
      predicate: (query) => isAutomationQuery(query.queryKey),
    });
  });

  events.on(automationRunUpdatedChannel, ({ automationId, runId, status, taskId }) => {
    updateAutomationRunStatus(automationId, { runId, status, taskId });
    void queryClient.invalidateQueries({ queryKey: ['automations', 'runs', automationId] });
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'automations' && query.queryKey[1] === 'recent-runs',
    });
    if (status === 'success') {
      const now = Date.now();
      queryClient.setQueriesData<Automation[]>(
        {
          predicate: (query) => isAutomationQuery(query.queryKey),
        },
        (current) =>
          current?.map((automation) =>
            automation.id === automationId ? { ...automation, lastRunAt: now } : automation
          )
      );
    }
  });
}
