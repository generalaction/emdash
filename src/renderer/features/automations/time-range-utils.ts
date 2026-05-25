import { endOfDay, startOfDay, startOfWeek, subDays } from 'date-fns';
import type { AutomationRunsTimeRange } from '@renderer/features/automations/automation-runs-filter-types';

export function isWithinTimeRange(timestamp: number, range: AutomationRunsTimeRange): boolean {
  const now = Date.now();
  const { start, end } = timeRangeBounds(range, now);
  return timestamp >= start && timestamp <= end;
}

function timeRangeBounds(
  range: AutomationRunsTimeRange,
  now: number
): { start: number; end: number } {
  const date = new Date(now);
  switch (range) {
    case 'last-24-hours':
      return { start: now - 24 * 60 * 60 * 1000, end: now };
    case 'today':
      return { start: startOfDay(date).getTime(), end: endOfDay(date).getTime() };
    case 'yesterday': {
      const yesterday = subDays(date, 1);
      return { start: startOfDay(yesterday).getTime(), end: endOfDay(yesterday).getTime() };
    }
    case 'this-week':
      return { start: startOfWeek(date, { weekStartsOn: 1 }).getTime(), end: now };
    case 'last-7-days':
      return { start: startOfDay(subDays(date, 6)).getTime(), end: now };
    case 'last-30-days':
      return { start: startOfDay(subDays(date, 29)).getTime(), end: now };
  }
}
