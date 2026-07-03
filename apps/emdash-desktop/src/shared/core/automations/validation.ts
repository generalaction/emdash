import { Cron } from 'croner';
import * as rrule from 'rrule';
import type { TriggerConfig } from './config';
import { getLocalTimeZone } from './timezone';

type RRuleModule = typeof rrule;
type RRuleModuleWithDefault = RRuleModule & { default?: RRuleModule };
type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function triggerKind(trigger: TriggerConfig): NonNullable<TriggerConfig['kind']> {
  return trigger.kind ?? 'cron';
}

function getRRuleStr() {
  // Electron's main bundle can expose rrule as either ESM named exports or a CJS
  // default object, depending on which side of the app imports it.
  const mod = rrule as RRuleModuleWithDefault;
  return mod.rrulestr ?? mod.default?.rrulestr;
}

function hasDtstart(expr: string): boolean {
  return /^DTSTART(?:;[^:]*)?:/im.test(expr);
}

function hasRRulePrefix(expr: string): boolean {
  return /^RRULE:/im.test(expr);
}

function getTimeZone(trigger: TriggerConfig): string {
  return trigger.tz || getLocalTimeZone();
}

function getRRuleTimeZone(trigger: TriggerConfig): string {
  const tzidMatch = /^DTSTART;[^:]*TZID=([^;:]+)[^:]*:/im.exec(trigger.expr);
  if (tzidMatch?.[1]) return tzidMatch[1];
  if (/^DTSTART(?:;[^:]*)?:\d{8}T\d{6}Z/im.test(trigger.expr)) return 'UTC';
  return getTimeZone(trigger);
}

function getDateParts(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function partsToUtc(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function dateToFloatingDateInTimeZone(date: Date, timeZone: string): Date {
  return new Date(partsToUtc(getDateParts(date, timeZone)));
}

function floatingDateToUtc(date: Date, timeZone: string): number {
  const floatingParts: DateParts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
  const utcGuess = partsToUtc(floatingParts);
  const guessPartsInZone = getDateParts(new Date(utcGuess), timeZone);
  const offset = partsToUtc(guessPartsInZone) - utcGuess;
  return utcGuess - offset;
}

function formatDtstart(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}${pad(parts.month)}${pad(parts.day)}T${pad(parts.hour)}${pad(
    parts.minute
  )}${pad(parts.second)}`;
}

export function normalizeTriggerConfig(
  trigger: TriggerConfig,
  anchor: number | Date = new Date()
): TriggerConfig {
  if (triggerKind(trigger) !== 'rrule') return trigger;

  const expr = trigger.expr.trim();
  if (hasDtstart(expr)) return { ...trigger, expr };

  const timeZone = getTimeZone(trigger);
  const anchorDate = anchor instanceof Date ? anchor : new Date(anchor);
  const rruleExpr = hasRRulePrefix(expr) ? expr : `RRULE:${expr}`;
  return {
    ...trigger,
    expr: `DTSTART;TZID=${timeZone}:${formatDtstart(anchorDate, timeZone)}\n${rruleExpr}`,
    tz: timeZone,
  };
}

export function getNextTriggerRunAt(
  trigger: TriggerConfig,
  from: number | Date = new Date()
): number | null {
  const fromDate = from instanceof Date ? from : new Date(from);

  if (triggerKind(trigger) === 'rrule') {
    const rrulestr = getRRuleStr();
    if (!rrulestr) throw new Error('rrule_invalid');
    const normalizedTrigger = normalizeTriggerConfig(trigger, fromDate);
    const timeZone = getRRuleTimeZone(normalizedTrigger);
    const rule = rrulestr(normalizedTrigger.expr.trim(), { tzid: timeZone });
    const floatingFromDate = dateToFloatingDateInTimeZone(fromDate, timeZone);
    const next = rule.after(floatingFromDate, false);
    return next ? floatingDateToUtc(next, timeZone) : null;
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

export function formatTriggerScheduleLabel(trigger: TriggerConfig): string {
  if (triggerKind(trigger) === 'rrule') {
    try {
      const rrulestr = getRRuleStr();
      const normalizedTrigger = normalizeTriggerConfig(trigger);
      const rule = rrulestr?.(normalizedTrigger.expr.trim(), {
        tzid: getRRuleTimeZone(normalizedTrigger),
      });
      const text = rule && 'toText' in rule ? rule.toText() : null;
      return text ? text[0]?.toUpperCase() + text.slice(1) : 'Custom RRULE';
    } catch {
      return trigger.expr;
    }
  }

  try {
    return new Cron(trigger.expr, { timezone: trigger.tz || getLocalTimeZone() }).toString();
  } catch {
    return trigger.expr;
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
