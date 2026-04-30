import { eventMatchesFilters } from '@shared/automations/event-filters';
import type { AutomationEvent } from '@shared/automations/events';
import { log } from '@main/lib/logger';
import { findEnabledEventAutomations } from './event-cache';
import { runAutomation } from './runtime';

export async function dispatchEvent(event: AutomationEvent): Promise<void> {
  const candidates = await findEnabledEventAutomations({
    kind: event.kind,
    projectId: event.projectId,
  });
  if (candidates.length === 0) return;

  const matched = candidates.filter(
    (automation) =>
      automation.trigger.kind === 'event' && eventMatchesFilters(event, automation.trigger.filters)
  );
  if (matched.length === 0) return;

  log.info('automations.dispatcher: dispatching event', {
    kind: event.kind,
    projectId: event.projectId,
    candidateCount: candidates.length,
    matchCount: matched.length,
  });

  for (const automation of matched) {
    runAutomation(automation, 'event', event).catch((error) => {
      log.error('automations.dispatcher: run failed', {
        automationId: automation.id,
        kind: event.kind,
        error: String(error),
      });
    });
  }
}
