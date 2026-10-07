import { describe, expect, it } from 'vitest';
import { codexUsageWindows } from './usage';

describe('Codex subscription limits', () => {
  it('preserves named buckets, account identity, percent scale and reset seconds', () => {
    const main = {
      primary: { usedPercent: 32, resetsAt: 1800000000, windowDurationMins: 300 },
      secondary: { usedPercent: 87, windowDurationMins: 10080 },
    };
    const usage = codexUsageWindows({
      accountId: 'account-1',
      rateLimits: main,
      rateLimitsByLimitId: {
        codex: main,
        spark: { limitName: 'Spark', primary: { usedPercent: 12 } },
      },
    });
    expect(usage.accountId).toBe('account-1');
    expect(usage.windows).toEqual([
      {
        id: 'codex:primary',
        label: '5-hour',
        usedPercent: 32,
        resetsAt: 1800000000000,
        durationMinutes: 300,
      },
      {
        id: 'codex:secondary',
        label: 'Weekly',
        usedPercent: 87,
        resetsAt: null,
        durationMinutes: 10080,
      },
      {
        id: 'spark:primary',
        label: 'Spark · Primary limit',
        usedPercent: 12,
        resetsAt: null,
        durationMinutes: undefined,
      },
    ]);
  });
  it('does not invent windows or percentages for absent values', () => {
    expect(codexUsageWindows({ rateLimits: {} }).windows).toEqual([]);
    expect(
      codexUsageWindows({ rateLimits: { primary: { usedPercent: null } } }).windows[0]?.usedPercent
    ).toBeNull();
    expect(
      codexUsageWindows({ rateLimits: { primary: { usedPercent: 112 } } }).windows[0]?.usedPercent
    ).toBe(100);
  });
});
