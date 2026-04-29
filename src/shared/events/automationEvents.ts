import { defineEvent } from '@shared/ipc/events';

export const automationsChangedChannel = defineEvent<void>('automations:changed');

export const automationRunUpdatedChannel = defineEvent<{
  automationId: string;
  runId: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  taskId?: string | null;
  sessionId?: string;
}>('automations:run-updated');
