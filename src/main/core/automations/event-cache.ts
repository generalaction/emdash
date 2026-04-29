import type { AutomationEventKind, EventProviderScope } from '@shared/automations/events';
import type { Automation } from '@shared/automations/types';
import { automationsChangedChannel } from '@shared/events/automationEvents';
import { events } from '@main/lib/events';
import { enabledEventAutomations } from './repo';

let cache: Automation[] | null = null;
let inflight: Promise<Automation[]> | null = null;
let generation = 0;
let wired = false;

function invalidate(): void {
  generation++;
  cache = null;
  inflight = null;
}

function ensureWired(): void {
  if (wired) return;
  wired = true;
  events.on(automationsChangedChannel, invalidate);
}

async function loadAll(): Promise<Automation[]> {
  ensureWired();
  if (cache) return cache;
  if (!inflight) {
    const startedAt = generation;
    inflight = enabledEventAutomations({}).then((rows) => {
      if (generation === startedAt) {
        cache = rows;
        inflight = null;
      }
      return rows;
    });
  }
  return inflight;
}

function matches(
  automation: Automation,
  filter: { kind: AutomationEventKind; provider: EventProviderScope; projectId: string }
): boolean {
  if (automation.trigger.kind !== 'event') return false;
  if (automation.projectId !== filter.projectId) return false;
  if (automation.trigger.event !== filter.kind) return false;
  const scoped = automation.trigger.provider ?? null;
  if (scoped == null) return true;
  return scoped === filter.provider;
}

export async function findEnabledEventAutomations(filter: {
  kind: AutomationEventKind;
  provider: EventProviderScope;
  projectId: string;
}): Promise<Automation[]> {
  const all = await loadAll();
  if (all.length === 0) return [];
  return all.filter((automation) => matches(automation, filter));
}

export async function hasAnyEnabledEventAutomation(): Promise<boolean> {
  const all = await loadAll();
  return all.length > 0;
}
