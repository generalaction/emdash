import { Cron } from 'croner';
import type { AutomationDeadlinePolicy } from '@shared/automations/automation-run';
import type { TriggerConfig } from '@shared/automations/config';
import { getLocalTimeZone } from '@shared/automations/timezone';

const DEADLINE_POLICIES: ReadonlySet<AutomationDeadlinePolicy> = new Set([
  'next-interval',
  'fixed',
  'none',
]);

export function assertValidCronTrigger(trigger: TriggerConfig): void {
  const expr = trigger.expr.trim();
  if (!expr) throw new Error('cron_invalid');
  if (expr.split(/\s+/).length !== 5) throw new Error('cron_invalid');

  try {
    const nextRun = new Cron(expr, { timezone: trigger.tz || getLocalTimeZone() }).nextRun(
      new Date()
    );
    if (!nextRun) throw new Error('cron_invalid');
  } catch {
    throw new Error('cron_invalid');
  }
}

export function assertValidDeadline(
  policy: AutomationDeadlinePolicy,
  deadlineMs: number | null
): void {
  if (!DEADLINE_POLICIES.has(policy)) throw new Error('deadline_policy_invalid');
  if (deadlineMs === null) return;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error('deadline_ms_invalid');
  }
}
