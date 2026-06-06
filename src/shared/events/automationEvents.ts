import type { AutomationRun } from '@shared/automations/automation-run';
import { defineEvent } from '@shared/ipc/events';

export const automationChangedChannel = defineEvent<{ automationId: string }>('automation:changed');

export const automationRunChangedChannel = defineEvent<{
  automationId: string;
  run: AutomationRun;
}>('automation:run-changed');
