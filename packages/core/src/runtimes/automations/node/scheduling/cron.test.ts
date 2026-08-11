import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextOccurrence, nextRunTimes, validateAutomationSchedule } from './cron';

const losAngelesMorning = {
  expr: '0 9 * * *',
  tz: 'America/Los_Angeles',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('validateAutomationSchedule', () => {
  const after = Date.UTC(2026, 0, 1);

  it('accepts a schedule with a future occurrence', () => {
    expect(validateAutomationSchedule(losAngelesMorning, after)).toBeNull();
  });

  it('rejects expressions that do not contain five fields', () => {
    expect(validateAutomationSchedule({ expr: '0 9 * *', tz: 'UTC' }, after)).toMatchObject({
      type: 'invalid-schedule',
      reason: 'malformed_expression',
    });
  });

  it('rejects invalid expressions and timezones', () => {
    expect(
      validateAutomationSchedule({ expr: 'invalid cron expression * *', tz: 'UTC' }, after)
    ).toMatchObject({ reason: 'invalid_expression_or_timezone' });
    expect(
      validateAutomationSchedule({ expr: '0 9 * * *', tz: 'Not/A_Timezone' }, after)
    ).toMatchObject({ reason: 'invalid_expression_or_timezone' });
    expect(validateAutomationSchedule({ expr: '0 9 * * *', tz: '' }, after)).toMatchObject({
      reason: 'invalid_expression_or_timezone',
    });
  });

  it('rejects schedules without a future occurrence', () => {
    expect(validateAutomationSchedule({ expr: '0 0 31 2 *', tz: 'UTC' }, after)).toMatchObject({
      reason: 'no_future_occurrence',
    });
  });
});

describe('nextOccurrence', () => {
  it('computes the next occurrence in the schedule timezone', () => {
    expect(nextOccurrence(losAngelesMorning, Date.UTC(2026, 0, 1))).toBe(Date.UTC(2026, 0, 1, 17));
  });

  it('returns an occurrence strictly after the supplied timestamp', () => {
    expect(nextOccurrence(losAngelesMorning, Date.UTC(2026, 0, 1, 17))).toBe(
      Date.UTC(2026, 0, 2, 17)
    );
  });

  it('respects daylight-saving transitions in an IANA timezone', () => {
    expect(nextOccurrence(losAngelesMorning, Date.UTC(2026, 2, 7, 18))).toBe(
      Date.UTC(2026, 2, 8, 16)
    );
  });

  it('does not register Croner timers', () => {
    vi.useFakeTimers();
    const timerCount = vi.getTimerCount();

    nextOccurrence(losAngelesMorning, Date.UTC(2026, 0, 1));

    expect(vi.getTimerCount()).toBe(timerCount);
  });
});

describe('nextRunTimes', () => {
  it('uses the following occurrence as the run deadline', () => {
    expect(nextRunTimes(losAngelesMorning, Date.UTC(2026, 0, 1))).toEqual({
      scheduledAt: Date.UTC(2026, 0, 1, 17),
      deadlineAt: Date.UTC(2026, 0, 2, 17),
    });
  });
});
