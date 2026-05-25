import { describe, expect, it } from 'vitest';
import { builtinAutomationCatalog } from './builtin-catalog';
import { parseCronToSchedule, scheduleToCron, type ScheduleSpec } from './schedule';

describe('automation schedule parsing', () => {
  it('rejects cron values outside picker bounds', () => {
    expect(parseCronToSchedule('60 9 * * *')).toBeNull();
    expect(parseCronToSchedule('0 24 * * *')).toBeNull();
    expect(parseCronToSchedule('60 * * * *')).toBeNull();
    expect(parseCronToSchedule('*/60 * * * *')).toBeNull();
  });

  it('keeps builtin catalog crons editable in the schedule picker', () => {
    for (const template of builtinAutomationCatalog) {
      expect(parseCronToSchedule(template.defaultTrigger.expr), template.id).not.toBeNull();
    }
  });

  it('round-trips every schedule kind through cron', () => {
    const schedules: ScheduleSpec[] = [
      { kind: 'daily', hour: 9, minute: 0 },
      { kind: 'weekdays', hour: 10, minute: 15 },
      { kind: 'weekends', hour: 11, minute: 30 },
      { kind: 'weekly', hour: 12, minute: 45, weekday: 'WED' },
      { kind: 'hourly', minute: 20 },
      { kind: 'interval', intervalMinutes: 30 },
    ];

    for (const schedule of schedules) {
      expect(parseCronToSchedule(scheduleToCron(schedule))).toEqual(schedule);
    }
  });
});
