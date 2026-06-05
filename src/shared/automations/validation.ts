import { Cron } from 'croner';
import { getLocalTimeZone } from '@shared/automations/timezone';
import type { AutomationDeadlinePolicy, CronTrigger, WebhookTrigger } from '@shared/automations/types';

const DEADLINE_POLICIES: ReadonlySet<AutomationDeadlinePolicy> = new Set([
  'next-interval',
  'fixed',
  'none',
]);

export function assertValidCronTrigger(trigger: CronTrigger): void {
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

export function assertValidWebhookTrigger(trigger: WebhookTrigger): void {
  if (!trigger.token || trigger.token.trim().length === 0) {
    throw new Error('webhook_trigger_token_required');
  }
  if (!trigger.serverUrl || trigger.serverUrl.trim().length === 0) {
    throw new Error('webhook_trigger_server_url_required');
  }
}
