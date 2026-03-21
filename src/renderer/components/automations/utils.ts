import type { AutomationSchedule, DayOfWeek } from '@shared/automations/types';

const DAY_LABELS: Record<DayOfWeek, string> = {
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
    case 'custom':
      return schedule.cronExpression ?? 'Custom schedule';
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

export const DAYS_OF_WEEK: { value: DayOfWeek; label: string }[] = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

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
