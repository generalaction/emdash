import { describe, expect, it } from 'vitest';
import { assertValidTrigger, getNextTriggerRunAt } from './validation';

describe('automation trigger validation', () => {
  it('accepts legacy cron triggers', () => {
    expect(() => assertValidTrigger({ expr: '0 9 * * 1', tz: 'UTC' })).not.toThrow();
  });

  it('accepts RRULE triggers and computes the next run', () => {
    const nextRunAt = getNextTriggerRunAt(
      {
        kind: 'rrule',
        expr: 'DTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO',
      },
      Date.UTC(2026, 6, 1, 0, 0, 0)
    );

    expect(nextRunAt).toBe(Date.UTC(2026, 6, 6, 9, 0, 0));
  });

  it('rejects invalid RRULE triggers', () => {
    expect(() => assertValidTrigger({ kind: 'rrule', expr: 'not an rrule' })).toThrow(
      'rrule_invalid'
    );
  });
});
