import type { AutomationRunStatus } from '@shared/automations/types';
import { defineEvent } from '@shared/ipc/events';

export const automationsChangedChannel = defineEvent<void>('automations:changed');

export const automationRunUpdatedChannel = defineEvent<{
  automationId: string;
  runId: string;
  status: AutomationRunStatus;
  taskId?: string | null;
}>('automations:run-updated');
