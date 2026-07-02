import { Cron } from 'croner';
import * as rrule from 'rrule';
import type { TriggerConfig } from './config';
import { getLocalTimeZone } from './timezone';

type RRuleModule = typeof rrule;
type RRuleModuleWithDefault = RRuleModule & { default?: RRuleModule };

function triggerKind(trigger: TriggerConfig): NonNullable<TriggerConfig['kind']> {
  return trigger.kind ?? 'cron';
}

function getRRuleStr() {
  const mod = rrule as RRuleModuleWithDefault;
  return mod.rrulestr ?? mod.default?.rrulestr;
}

export function getNextTriggerRunAt(
  trigger: TriggerConfig,
  from: number | Date = new Date()
): number | null {
  const fromDate = from instanceof Date ? from : new Date(from);

  if (triggerKind(trigger) === 'rrule') {
    const rrulestr = getRRuleStr();
    if (!rrulestr) throw new Error('rrule_invalid');
    const rule = rrulestr(trigger.expr.trim());
    return rule.after(fromDate, false)?.getTime() ?? null;
  }

  const next = new Cron(trigger.expr, { timezone: trigger.tz || getLocalTimeZone() }).nextRun(
    fromDate
  );
  return next?.getTime() ?? null;
}

export function assertValidCronTrigger(trigger: TriggerConfig): void {
  const expr = trigger.expr.trim();
  if (!expr) throw new Error('cron_invalid');
  if (triggerKind(trigger) !== 'cron') throw new Error('cron_invalid');
  if (expr.split(/\s+/).length !== 5) throw new Error('cron_invalid');

  try {
    const nextRun = getNextTriggerRunAt(trigger);
    if (!nextRun) throw new Error('cron_invalid');
  } catch {
    throw new Error('cron_invalid');
  }
}

export function assertValidTrigger(trigger: TriggerConfig): void {
  if (triggerKind(trigger) === 'rrule') {
    try {
      const nextRun = getNextTriggerRunAt(trigger);
      if (!nextRun) throw new Error('rrule_invalid');
    } catch {
      throw new Error('rrule_invalid');
    }
    return;
  }

  assertValidCronTrigger(trigger);
}
