import type { AutomationEvent } from '@shared/automations/events';
import { log } from '@main/lib/logger';
import { findEnabledEventAutomations } from './event-cache';
import { runAutomation } from './runtime';

export async function dispatchEvent(event: AutomationEvent): Promise<void> {
  const candidates = await findEnabledEventAutomations({
    kind: event.kind,
    provider: event.provider,
    projectId: event.projectId,
  });
  if (candidates.length === 0) return;

  log.info('automations.dispatcher: dispatching event', {
    kind: event.kind,
    provider: event.provider,
    projectId: event.projectId,
    matchCount: candidates.length,
  });

  for (const automation of candidates) {
    runAutomation(automation, 'event', event).catch((error) => {
      log.error('automations.dispatcher: run failed', {
        automationId: automation.id,
        kind: event.kind,
        error: String(error),
      });
    });
  }
}
