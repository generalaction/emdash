import { defineEvent } from '@shared/lib/ipc/events';
import type { AutomationRun } from './automation-run';

export const automationChangedChannel = defineEvent<{ automationId: string }>('automation:changed');

export const automationRunChangedChannel = defineEvent<{
  automationId: string;
  run: AutomationRun;
}>('automation:run-changed');
