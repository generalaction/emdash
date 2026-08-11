import { Cron } from 'croner';
import type { AutomationSchedule, InvalidScheduleError } from '../../api';

export type AutomationRunTimes = {
  scheduledAt: number;
  deadlineAt: number | null;
};

/** Validates schedule semantics relative to the runtime's clock. */
export function validateAutomationSchedule(
  schedule: AutomationSchedule,
  after: number
): InvalidScheduleError | null {
  if (schedule.expr.trim().split(/\s+/).length !== 5) {
    return {
      type: 'invalid-schedule',
      reason: 'malformed_expression',
      message: 'Cron expression must contain exactly five fields',
    };
  }

  if (!schedule.tz.trim()) {
    return {
      type: 'invalid-schedule',
      reason: 'invalid_expression_or_timezone',
      message: 'Cron expression or timezone is invalid',
    };
  }

  try {
    if (!new Cron(schedule.expr, { timezone: schedule.tz }).nextRun(new Date(after))) {
      return {
        type: 'invalid-schedule',
        reason: 'no_future_occurrence',
        message: 'Cron expression has no future occurrence',
      };
    }
  } catch {
    return {
      type: 'invalid-schedule',
      reason: 'invalid_expression_or_timezone',
      message: 'Cron expression or timezone is invalid',
    };
  }

  return null;
}

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
