import type { AutomationEventKind } from '@shared/automations/events';
import { getLocalTimeZone } from '@shared/automations/timezone';
import type {
  AutomationRunStatus,
  AutomationRunTriggerKind,
  TriggerSpec,
} from '@shared/automations/types';

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

function dayDescription(desc: DayOfWeekDesc): string | null {
  switch (desc.kind) {
    case 'all':
      return null;
    case 'weekdays':
      return 'Mon–Fri';
    case 'weekends':
      return 'Sat–Sun';
    case 'list':
      return joinLabels(desc.days.map((index) => dayNames[index]));
  }
}

function getTzOffsetMinutes(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = dtf.formatToParts(date);
    const get = (type: string) => {
      const part = parts.find((p) => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    const asUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second')
    );
    return (asUTC - date.getTime()) / 60000;
  } catch {
    return 0;
  }
}

interface ShiftedWallTime {
  hour: number;
  minute: number;
  dayShift: number;
}

function shiftWallTimeToLocal(
  hour: number,
  minute: number,
  fromTz: string
): ShiftedWallTime | null {
  const localTz = getLocalTimeZone();
  if (fromTz === localTz) return { hour, minute, dayShift: 0 };
  const ref = new Date();
  const fromOffset = getTzOffsetMinutes(ref, fromTz);
  const toOffset = getTzOffsetMinutes(ref, localTz);
  if (fromOffset === toOffset) return { hour, minute, dayShift: 0 };
  const total = hour * 60 + minute + (toOffset - fromOffset);
  const dayShift = Math.floor(total / 1440);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(wrapped / 60), minute: wrapped % 60, dayShift };
}

function shiftDayOfWeekDesc(desc: DayOfWeekDesc, shift: number): DayOfWeekDesc {
  if (shift === 0 || desc.kind === 'all') return desc;
  const source =
    desc.kind === 'weekdays' ? [1, 2, 3, 4, 5] : desc.kind === 'weekends' ? [0, 6] : desc.days;
  const shifted = Array.from(new Set(source.map((d) => (((d + shift) % 7) + 7) % 7))).sort(
    (a, b) => a - b
  );
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (eq(shifted, [1, 2, 3, 4, 5])) return { kind: 'weekdays' };
  if (eq(shifted, [0, 6])) return { kind: 'weekends' };
  return { kind: 'list', days: shifted };
}

export function formatCronLabel(expr: string, tz?: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const minNum = /^\d+$/.test(min) ? parseInt(min, 10) : null;
  const hourNum = /^\d+$/.test(hour) ? parseInt(hour, 10) : null;

  if (mon === '*' && dow === '*' && /^\d+$/.test(dom) && minNum !== null && hourNum !== null) {
    const day = parseInt(dom, 10);
    const shifted = tz ? shiftWallTimeToLocal(hourNum, minNum, tz) : null;
    const localHour = shifted?.hour ?? hourNum;
    const localMinute = shifted?.minute ?? minNum;
    const time = formatTimeOfDay(localHour, localMinute);
    const localDay = day + (shifted?.dayShift ?? 0);
    if (localDay >= 1 && localDay <= 28) {
      return `Monthly · ${ordinal(localDay)} · ${time}`;
    }
    return `Monthly · ${ordinal(day)} · ${time}`;
  }

  if (dom !== '*' || mon !== '*') return expr;

  const dowDesc = parseDayOfWeek(dow);
  if (!dowDesc) return expr;

  if (hour === '*') {
    if (min === '*') {
      if (dowDesc.kind === 'all') return 'Every minute';
      const days = dayDescription(dowDesc);
      return days ? `Every minute · ${days}` : expr;
    }
    const everyN = min.match(/^\*\/(\d+)$/);
    if (everyN) {
      if (dowDesc.kind === 'all') return `Every ${everyN[1]} min`;
      const days = dayDescription(dowDesc);
      return days ? `Every ${everyN[1]} min · ${days}` : expr;
    }
    if (minNum !== null) {
      const base = minNum === 0 ? 'Hourly' : `Hourly :${minNum.toString().padStart(2, '0')}`;
      if (dowDesc.kind === 'all') return base;
      const days = dayDescription(dowDesc);
      return days ? `${base} · ${days}` : expr;
    }
    return expr;
  }

  if (minNum !== null && hourNum !== null) {
    const shifted = tz ? shiftWallTimeToLocal(hourNum, minNum, tz) : null;
    const localHour = shifted?.hour ?? hourNum;
    const localMinute = shifted?.minute ?? minNum;
    const localDow = shifted ? shiftDayOfWeekDesc(dowDesc, shifted.dayShift) : dowDesc;
    const time = formatTimeOfDay(localHour, localMinute);
    if (localDow.kind === 'all') return `Daily · ${time}`;
    const days = dayDescription(localDow);
    return days ? `${days} · ${time}` : expr;
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
    case 'issue.opened':
      return 'New issue';
  }
}

export function formatTriggerLabel(trigger: TriggerSpec): string {
  return trigger.kind === 'cron'
    ? formatCronLabel(trigger.expr, trigger.tz)
    : formatEventLabel(trigger.event);
}

export function formatRunStatusLabel(status: AutomationRunStatus): string | null {
  switch (status) {
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'running':
      return 'Running';
    case 'success':
      return null;
  }
}

export function formatRunTriggerKindLabel(kind: AutomationRunTriggerKind): string {
  switch (kind) {
    case 'cron':
      return 'Schedule';
    case 'manual':
      return 'Manual';
    case 'event':
      return 'Event';
  }
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
