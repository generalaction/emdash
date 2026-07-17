import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextOccurrence, nextRunTimes } from './cron';

const losAngelesMorning = {
  expr: '0 9 * * *',
  tz: 'America/Los_Angeles',
};

afterEach(() => {
  vi.useRealTimers();
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
