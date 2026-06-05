import { defineEvent } from '@shared/ipc/events';
import type { AutomationRun } from '@shared/automations/automation-run';


export const automationChangedChannel = defineEvent<{ automationId: string }>(
  'automation:changed'
);

export const automationRunChangedChannel = defineEvent<{
  automationId: string;
  run: AutomationRun;
}>('automation:run-changed');
