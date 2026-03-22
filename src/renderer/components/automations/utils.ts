import type { AutomationSchedule, DayOfWeek, ScheduleType } from '@shared/automations/types';

export const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatScheduleLabel(schedule: AutomationSchedule): string {
  const time = `${pad2(schedule.hour ?? 0)}:${pad2(schedule.minute ?? 0)}`;

  switch (schedule.type) {
    case 'hourly':
      return `Every hour at :${pad2(schedule.minute ?? 0)}`;
    case 'daily':
      return `Daily at ${time}`;
    case 'weekly':
      return `Weekly on ${DAY_LABELS[schedule.dayOfWeek ?? 'mon']} at ${time}`;
    case 'monthly':
      return `Monthly on the ${ordinal(schedule.dayOfMonth ?? 1)} at ${time}`;
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isFuture = diffMs > 0;

  if (absDiffMs < 60_000) {
    return isFuture ? 'in <1m' : '<1m ago';
  }

  const minutes = Math.floor(absDiffMs / 60_000);
  if (minutes < 60) {
    return isFuture ? `in ${minutes}m` : `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return isFuture ? `in ${hours}h` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return isFuture ? `in ${days}d` : `${days}d ago`;
  }

  return date.toLocaleDateString();
}

export const SCHEDULE_TYPES = [
  { value: 'hourly' as const, label: 'Every hour' },
  { value: 'daily' as const, label: 'Daily' },
  { value: 'weekly' as const, label: 'Weekly' },
  { value: 'monthly' as const, label: 'Monthly' },
] as const;

export const DAYS_OF_WEEK: { value: DayOfWeek; label: string }[] = (
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
).map((value) => ({ value, label: DAY_LABELS[value] }));

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: pad2(i),
}));

export const MINUTES = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: pad2(i),
}));

export const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: ordinal(i + 1),
}));

/**
 * Shared schedule builder used by AutomationInlineCreate (create & edit modes).
 * Eliminates duplicate buildSchedule logic across components.
 */
export function buildSchedule(
  type: ScheduleType,
  hour: number,
  minute: number,
  dayOfWeek: string,
  dayOfMonth: number
): AutomationSchedule {
  const base: AutomationSchedule = { type, minute };
  // hour is irrelevant for hourly schedules (only minute matters)
  if (type !== 'hourly') base.hour = hour;
  if (type === 'weekly') base.dayOfWeek = dayOfWeek as DayOfWeek;
  if (type === 'monthly') base.dayOfMonth = dayOfMonth;
  return base;
}
