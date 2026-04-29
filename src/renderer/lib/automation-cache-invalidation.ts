import type { Automation } from '@shared/automations/types';
import {
  automationRunUpdatedChannel,
  automationsChangedChannel,
} from '@shared/events/automationEvents';
import { events } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

export function wireAutomationCacheInvalidation(): void {
  events.on(automationsChangedChannel, () => {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'automations' && query.queryKey[1] !== 'catalog',
    });
  });

  events.on(automationRunUpdatedChannel, ({ automationId, status }) => {
    queryClient.invalidateQueries({ queryKey: ['automations', 'runs', automationId] });
    if (status === 'success' || status === 'failed' || status === 'skipped') {
      const now = Date.now();
      queryClient.setQueriesData<Automation[]>(
        {
          predicate: (query) =>
            query.queryKey[0] === 'automations' && query.queryKey[1] !== 'catalog',
        },
        (current) =>
          current?.map((automation) =>
            automation.id === automationId ? { ...automation, lastRunAt: now } : automation
          )
      );
    }
  });
}
