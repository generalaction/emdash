import { Cron } from 'croner';
import type { TriggerConfig } from './config';
import { getLocalTimeZone } from './timezone';

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
