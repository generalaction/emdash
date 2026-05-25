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

export const WEEKDAY_LABELS: Record<WeekdayToken, string> = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  weekly: 'Weekly',
  hourly: 'Hourly',
  interval: 'Every N minutes',
};

export const SCHEDULE_KIND_ORDER: readonly ScheduleKind[] = [
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'hourly',
  'interval',
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

export const dayTokenIndex: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export function isWeekdaysToken(token: string): boolean {
  const upper = token.toUpperCase().replace(/\s+/g, '');
  return upper === 'MON-FRI' || upper === '1-5';
}

export function isWeekendToken(token: string): boolean {
  const upper = token.toUpperCase().replace(/\s+/g, '');
  return (
    upper === 'SAT,SUN' ||
    upper === 'SUN,SAT' ||
    upper === '0,6' ||
    upper === '6,0' ||
    // Some cron parsers accept both 0 and 7 as Sunday, so 6-7 means Saturday-Sunday.
    upper === '6-7'
  );
}

function parseWeekdayToken(token: string): WeekdayToken | null {
  const upper = token.toUpperCase();
  if (/^\d$/.test(upper)) {
    const n = parseInt(upper, 10);
    return n >= 0 && n <= 6 ? WEEKDAY_TOKENS[n] : null;
  }
  return upper in dayTokenIndex ? (upper as WeekdayToken) : null;
}

function isValidMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

function isValidHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

export function parseCronToSchedule(expr: string): ScheduleSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;

  const everyN = min.match(/^\*\/(\d+)$/);
  if (everyN && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(everyN[1], 10);
    return n >= 1 && n <= 59 ? { kind: 'interval', intervalMinutes: n } : null;
  }

  const minNum = /^\d+$/.test(min) ? parseInt(min, 10) : null;
  const hourNum = /^\d+$/.test(hour) ? parseInt(hour, 10) : null;

  if (minNum !== null && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return isValidMinute(minNum) ? { kind: 'hourly', minute: minNum } : null;
  }

  if (minNum !== null && hourNum !== null && dom === '*' && mon === '*') {
    if (!isValidMinute(minNum) || !isValidHour(hourNum)) return null;
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
