export type DurationUnit = 'minutes' | 'hours' | 'days';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function durationToMs(value: number, unit: DurationUnit): number {
  switch (unit) {
    case 'minutes':
      return value * MINUTE_MS;
    case 'hours':
      return value * HOUR_MS;
    case 'days':
      return value * DAY_MS;
  }
}

export function msToDuration(ms: number): { value: number; unit: DurationUnit } {
  if (ms % DAY_MS === 0) return { value: ms / DAY_MS, unit: 'days' };
  if (ms % HOUR_MS === 0) return { value: ms / HOUR_MS, unit: 'hours' };
  return { value: Math.max(1, Math.round(ms / MINUTE_MS)), unit: 'minutes' };
}
