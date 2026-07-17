import { Cron } from 'croner';
import type { AutomationSchedule } from '../api';

export type AutomationRunTimes = {
  scheduledAt: number;
  deadlineAt: number | null;
};

/** Returns the first scheduled occurrence strictly after `after`. */
export function nextOccurrence(schedule: AutomationSchedule, after: number): number | null {
  return (
    new Cron(schedule.expr, { timezone: schedule.tz }).nextRun(new Date(after))?.getTime() ?? null
  );
}

/**
 * Returns the next run time and the following occurrence, when the run becomes
 * stale. The scheduler supplies `from` through its injected clock.
 */
export function nextRunTimes(
  schedule: AutomationSchedule,
  from: number
): AutomationRunTimes | null {
  const scheduledAt = nextOccurrence(schedule, from);
  if (scheduledAt === null) return null;

  return {
    scheduledAt,
    deadlineAt: nextOccurrence(schedule, scheduledAt),
  };
}
