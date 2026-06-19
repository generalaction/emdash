import type { CronPeriod, CronState } from './types';

export const MONTH_LABELS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const WEEKDAY_LABELS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const PERIOD_LABELS: Record<CronPeriod, string> = {
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

export const PERIOD_ORDER: readonly CronPeriod[] = [
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'year',
];

export const DEFAULT_CRON_STATE: CronState = {
  period: 'day',
  minute: 0,
  hour: 9,
  monthDay: 1,
  month: 1,
  weekDay: 1,
};

export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (abs % 10) {
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

function isWildcard(part: string): boolean {
  return part === '*';
}

function parseIntField(part: string): number | null {
  if (!/^\d+$/.test(part)) return null;
  return parseInt(part, 10);
}

/**
 * Parses a cron expression into a CronState.
 * Returns null if the expression does not match the supported subset.
 *
 * Supported patterns:
 *   minute: `* * * * *`
 *   hour:   `M * * * *`
 *   day:    `M H * * *`
 *   week:   `M H * * DOW`
 *   month:  `M H DOM * *`
 *   year:   `M H DOM MON *`
 */
export function parseCron(expr: string): CronState | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, domPart, monPart, dowPart] = parts;

  // Every minute: `* * * * *`
  if (
    isWildcard(minPart) &&
    isWildcard(hourPart) &&
    isWildcard(domPart) &&
    isWildcard(monPart) &&
    isWildcard(dowPart)
  ) {
    return { ...DEFAULT_CRON_STATE, period: 'minute' };
  }

  const min = parseIntField(minPart);
  const hour = parseIntField(hourPart);
  const dom = parseIntField(domPart);
  const mon = parseIntField(monPart);
  const dow = parseIntField(dowPart);

  // Every hour: `M * * * *`
  if (
    min !== null &&
    isWildcard(hourPart) &&
    isWildcard(domPart) &&
    isWildcard(monPart) &&
    isWildcard(dowPart)
  ) {
    if (min < 0 || min > 59) return null;
    return { ...DEFAULT_CRON_STATE, period: 'hour', minute: min };
  }

  // Every day / week: require M H, dom=*, mon=*
  if (min !== null && hour !== null && isWildcard(domPart) && isWildcard(monPart)) {
    if (min < 0 || min > 59 || hour < 0 || hour > 23) return null;

    // Every day: dow=*
    if (isWildcard(dowPart)) {
      return { ...DEFAULT_CRON_STATE, period: 'day', minute: min, hour };
    }

    // Every week: dow is numeric 0-6
    if (dow !== null && dow >= 0 && dow <= 6) {
      return { ...DEFAULT_CRON_STATE, period: 'week', minute: min, hour, weekDay: dow };
    }

    return null;
  }

  // Every month / year: require M H DOM, dow=*
  if (min !== null && hour !== null && dom !== null && isWildcard(dowPart)) {
    if (min < 0 || min > 59 || hour < 0 || hour > 23 || dom < 1 || dom > 31) return null;

    // Every month: mon=*
    if (isWildcard(monPart)) {
      return { ...DEFAULT_CRON_STATE, period: 'month', minute: min, hour, monthDay: dom };
    }

    // Every year: mon is numeric 1-12
    if (mon !== null && mon >= 1 && mon <= 12) {
      return {
        ...DEFAULT_CRON_STATE,
        period: 'year',
        minute: min,
        hour,
        monthDay: dom,
        month: mon,
      };
    }

    return null;
  }

  return null;
}

/**
 * Converts a CronState to a cron expression string.
 */
export function toCron(state: CronState): string {
  switch (state.period) {
    case 'minute':
      return '* * * * *';
    case 'hour':
      return `${state.minute} * * * *`;
    case 'day':
      return `${state.minute} ${state.hour} * * *`;
    case 'week':
      return `${state.minute} ${state.hour} * * ${state.weekDay}`;
    case 'month':
      return `${state.minute} ${state.hour} ${state.monthDay} * *`;
    case 'year':
      return `${state.minute} ${state.hour} ${state.monthDay} ${state.month} *`;
  }
}

/**
 * When changing period, carry forward compatible fields and set sensible defaults
 * for newly relevant fields.
 */
export function changePeriod(prev: CronState, period: CronPeriod): CronState {
  switch (period) {
    case 'minute':
      return { ...prev, period };
    case 'hour':
      return { ...prev, period };
    case 'day':
      return { ...prev, period };
    case 'week':
      return { ...prev, period, weekDay: prev.weekDay };
    case 'month':
      return { ...prev, period, monthDay: prev.monthDay };
    case 'year':
      return { ...prev, period, monthDay: prev.monthDay, month: prev.month };
  }
}

/** Returns a padded time string like "09:05" from hour and minute numbers. */
export function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}
