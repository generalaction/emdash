import type { AutomationEventKind } from '@shared/automations/events';
import type { TriggerSpec } from '@shared/automations/types';

const dayNames = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
] as const;

const dayTokenIndex: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatTimeOfDay(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  if (minute === 0) return `${h12} ${period}`;
  return `${h12}:${minute.toString().padStart(2, '0')} ${period}`;
}

function isWeekdaysToken(token: string): boolean {
  const upper = token.toUpperCase().replace(/\s+/g, '');
  return upper === 'MON-FRI' || upper === '1-5';
}

function isWeekendToken(token: string): boolean {
  const upper = token.toUpperCase().replace(/\s+/g, '');
  return (
    upper === 'SAT,SUN' ||
    upper === 'SUN,SAT' ||
    upper === '0,6' ||
    upper === '6,0' ||
    upper === '6-7' ||
    upper === '0,7'
  );
}

type DayOfWeekDesc =
  | { kind: 'all' }
  | { kind: 'weekdays' }
  | { kind: 'weekends' }
  | { kind: 'list'; days: number[] };

function parseDayOfWeek(dow: string): DayOfWeekDesc | null {
  if (dow === '*') return { kind: 'all' };
  if (isWeekdaysToken(dow)) return { kind: 'weekdays' };
  if (isWeekendToken(dow)) return { kind: 'weekends' };

  const tokens = dow.split(',').map((token) => token.trim());
  const days: number[] = [];
  for (const token of tokens) {
    if (token.length === 0) return null;
    const upper = token.toUpperCase();
    if (/^\d$/.test(upper)) {
      const n = parseInt(upper, 10);
      if (n < 0 || n > 6) return null;
      days.push(n);
    } else if (upper in dayTokenIndex) {
      days.push(dayTokenIndex[upper]);
    } else {
      return null;
    }
  }
  if (days.length === 0) return null;
  return { kind: 'list', days };
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(', ')} and ${last}`;
}

function dayDescriptionPrefix(desc: DayOfWeekDesc): string | null {
  switch (desc.kind) {
    case 'all':
      return null;
    case 'weekdays':
      return 'Weekdays';
    case 'weekends':
      return 'Weekends';
    case 'list':
      return joinLabels(desc.days.map((index) => dayNames[index]));
  }
}

function dayDescriptionSuffix(desc: DayOfWeekDesc): string | null {
  switch (desc.kind) {
    case 'all':
      return null;
    case 'weekdays':
      return 'weekdays';
    case 'weekends':
      return 'weekends';
    case 'list':
      return joinLabels(desc.days.map((index) => dayNames[index]));
  }
}

export function formatCronLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const minNum = /^\d+$/.test(min) ? parseInt(min, 10) : null;
  const hourNum = /^\d+$/.test(hour) ? parseInt(hour, 10) : null;

  if (mon === '*' && dow === '*' && /^\d+$/.test(dom) && minNum !== null && hourNum !== null) {
    const day = parseInt(dom, 10);
    const time = formatTimeOfDay(hourNum, minNum);
    return `Monthly on the ${ordinal(day)} at ${time}`;
  }

  if (dom !== '*' || mon !== '*') return expr;

  const dowDesc = parseDayOfWeek(dow);
  if (!dowDesc) return expr;

  if (hour === '*') {
    if (min === '*') {
      if (dowDesc.kind === 'all') return 'Every minute';
      const suffix = dayDescriptionSuffix(dowDesc);
      return suffix ? `Every minute on ${suffix}` : expr;
    }
    const everyN = min.match(/^\*\/(\d+)$/);
    if (everyN) {
      if (dowDesc.kind === 'all') return `Every ${everyN[1]} minutes`;
      const suffix = dayDescriptionSuffix(dowDesc);
      return suffix ? `Every ${everyN[1]} minutes on ${suffix}` : expr;
    }
    if (minNum !== null) {
      const base = minNum === 0 ? 'Hourly' : `Hourly at :${minNum.toString().padStart(2, '0')}`;
      if (dowDesc.kind === 'all') return base;
      const suffix = dayDescriptionSuffix(dowDesc);
      return suffix ? `${base} on ${suffix}` : expr;
    }
    return expr;
  }

  if (minNum !== null && hourNum !== null) {
    const time = formatTimeOfDay(hourNum, minNum);
    if (dowDesc.kind === 'all') return `Daily at ${time}`;
    const prefix = dayDescriptionPrefix(dowDesc);
    return prefix ? `${prefix} at ${time}` : expr;
  }

  return expr;
}

export function formatEventLabel(event: AutomationEventKind): string {
  switch (event) {
    case 'pr.opened':
      return 'New pull request';
    case 'pr.merged':
      return 'PR merged';
    case 'pr.closed':
      return 'PR closed';
    case 'pr.review_requested':
      return 'PR review requested';
    case 'ci.failed':
      return 'CI failure';
    case 'ci.succeeded':
      return 'CI succeeded';
    case 'issue.opened':
      return 'New issue';
    case 'issue.closed':
      return 'Issue closed';
    case 'issue.assigned':
      return 'Issue assigned';
    case 'issue.commented':
      return 'Issue commented';
  }
}

export function formatTriggerLabel(trigger: TriggerSpec): string {
  return trigger.kind === 'cron' ? formatCronLabel(trigger.expr) : formatEventLabel(trigger.event);
}

export type ScheduleKind = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'hourly' | 'interval';
export type WeekdayToken = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

export const WEEKDAY_TOKENS: readonly WeekdayToken[] = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
];

export const INTERVAL_MINUTE_OPTIONS = [5, 10, 15, 30] as const;

export type ScheduleSpec =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekdays'; hour: number; minute: number }
  | { kind: 'weekends'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; weekday: WeekdayToken }
  | { kind: 'hourly'; minute: number }
  | { kind: 'interval'; intervalMinutes: number };

export const DEFAULT_SCHEDULE: ScheduleSpec = { kind: 'daily', hour: 9, minute: 0 };

function parseWeekdayToken(token: string): WeekdayToken | null {
  const upper = token.toUpperCase();
  if (/^\d$/.test(upper)) {
    const n = parseInt(upper, 10);
    return n >= 0 && n <= 6 ? WEEKDAY_TOKENS[n] : null;
  }
  return upper in dayTokenIndex ? (upper as WeekdayToken) : null;
}

export function parseCronToSchedule(expr: string): ScheduleSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;

  const everyN = min.match(/^\*\/(\d+)$/);
  if (everyN && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(everyN[1], 10);
    return n > 0 ? { kind: 'interval', intervalMinutes: n } : null;
  }

  const minNum = /^\d+$/.test(min) ? parseInt(min, 10) : null;
  const hourNum = /^\d+$/.test(hour) ? parseInt(hour, 10) : null;

  if (minNum !== null && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'hourly', minute: minNum };
  }

  if (minNum !== null && hourNum !== null && dom === '*' && mon === '*') {
    if (dow === '*') return { kind: 'daily', hour: hourNum, minute: minNum };
    if (isWeekdaysToken(dow)) return { kind: 'weekdays', hour: hourNum, minute: minNum };
    if (isWeekendToken(dow)) return { kind: 'weekends', hour: hourNum, minute: minNum };
    const weekday = parseWeekdayToken(dow);
    if (weekday) return { kind: 'weekly', hour: hourNum, minute: minNum, weekday };
  }

  return null;
}

export function scheduleToCron(schedule: ScheduleSpec): string {
  switch (schedule.kind) {
    case 'daily':
      return `${schedule.minute} ${schedule.hour} * * *`;
    case 'weekdays':
      return `${schedule.minute} ${schedule.hour} * * MON-FRI`;
    case 'weekends':
      return `${schedule.minute} ${schedule.hour} * * SAT,SUN`;
    case 'weekly':
      return `${schedule.minute} ${schedule.hour} * * ${schedule.weekday}`;
    case 'hourly':
      return `${schedule.minute} * * * *`;
    case 'interval':
      return `*/${schedule.intervalMinutes} * * * *`;
  }
}
