import { describe, expect, it } from 'vitest';
import {
  assertValidTrigger,
  formatTriggerScheduleLabel,
  getNextTriggerRunAt,
  normalizeTriggerConfig,
} from './validation';

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

  it('injects DTSTART when saving RRULE triggers without an anchor', () => {
    const normalized = normalizeTriggerConfig(
      { kind: 'rrule', expr: 'FREQ=WEEKLY;BYDAY=MO', tz: 'Europe/Berlin' },
      Date.UTC(2026, 6, 1, 7, 30, 0)
    );

    expect(normalized.expr).toBe(
      'DTSTART;TZID=Europe/Berlin:20260701T093000\nRRULE:FREQ=WEEKLY;BYDAY=MO'
    );
  });

  it('preserves case-insensitive RRULE property prefixes', () => {
    const normalized = normalizeTriggerConfig(
      { kind: 'rrule', expr: 'Rrule:FREQ=WEEKLY;BYDAY=MO', tz: 'UTC' },
      Date.UTC(2026, 6, 1, 9, 0, 0)
    );

    expect(normalized.expr).toBe('DTSTART;TZID=UTC:20260701T090000\nRrule:FREQ=WEEKLY;BYDAY=MO');
    expect(getNextTriggerRunAt(normalized, Date.UTC(2026, 6, 1, 10, 0, 0))).toBe(
      Date.UTC(2026, 6, 6, 9, 0, 0)
    );
  });

  it('does not double-prefix malformed RRULE-looking input', () => {
    const normalized = normalizeTriggerConfig(
      { kind: 'rrule', expr: 'Rrule FREQ=WEEKLY;BYDAY=MO', tz: 'UTC' },
      Date.UTC(2026, 6, 1, 9, 0, 0)
    );

    expect(normalized.expr).toBe('DTSTART;TZID=UTC:20260701T090000\nRrule FREQ=WEEKLY;BYDAY=MO');
    expect(() => assertValidTrigger(normalized)).toThrow('rrule_invalid');
  });

  it('keeps RRULE schedules stable across delayed scheduler passes', () => {
    const trigger = normalizeTriggerConfig(
      { kind: 'rrule', expr: 'FREQ=WEEKLY;BYDAY=MO', tz: 'UTC' },
      Date.UTC(2026, 6, 1, 9, 0, 0)
    );

    expect(getNextTriggerRunAt(trigger, Date.UTC(2026, 6, 6, 9, 0, 1))).toBe(
      Date.UTC(2026, 6, 13, 9, 0, 0)
    );
    expect(getNextTriggerRunAt(trigger, Date.UTC(2026, 6, 6, 9, 1, 30))).toBe(
      Date.UTC(2026, 6, 13, 9, 0, 0)
    );
  });

  it('uses RRULE time zones for local wall-clock schedules', () => {
    const trigger = {
      kind: 'rrule' as const,
      expr: 'DTSTART;TZID=Europe/Berlin:20260323T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
      tz: 'Europe/Berlin',
    };

    expect(getNextTriggerRunAt(trigger, Date.UTC(2026, 2, 30, 6, 30, 0))).toBe(
      Date.UTC(2026, 2, 30, 7, 0, 0)
    );
    expect(getNextTriggerRunAt(trigger, Date.UTC(2026, 2, 30, 7, 30, 0))).toBe(
      Date.UTC(2026, 3, 6, 7, 0, 0)
    );
  });

  it('rejects expired finite RRULE triggers', () => {
    expect(() =>
      assertValidTrigger({
        kind: 'rrule',
        expr: 'DTSTART:20200101T090000Z\nRRULE:FREQ=DAILY;COUNT=1',
      })
    ).toThrow('rrule_invalid');
  });

  it('formats RRULE labels as readable text', () => {
    expect(
      formatTriggerScheduleLabel({
        kind: 'rrule',
        expr: 'DTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO',
      })
    ).toBe('Every week on Monday');
  });

  it('rejects invalid RRULE triggers', () => {
    expect(() => assertValidTrigger({ kind: 'rrule', expr: 'not an rrule' })).toThrow(
      'rrule_invalid'
    );
  });
});
