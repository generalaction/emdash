import { describe, expect, it } from 'vitest';
import { collectWithBudget } from './collect-with-budget';

describe('collectWithBudget', () => {
  it('collects all paths when no budget is exceeded', async () => {
    await expect(
      collectWithBudget(['a.ts', 'b.ts'], {
        maxFiles: 10,
        timeoutMs: 1_000,
        now: () => 0,
      })
    ).resolves.toEqual({
      paths: ['a.ts', 'b.ts'],
      truncated: false,
      truncateReason: undefined,
    });
  });

  it('truncates at maxFiles', async () => {
    await expect(
      collectWithBudget(paths(['a.ts', 'b.ts', 'c.ts']), {
        maxFiles: 2,
        timeoutMs: 1_000,
        now: () => 0,
      })
    ).resolves.toEqual({
      paths: ['a.ts', 'b.ts'],
      truncated: true,
      truncateReason: 'maxEntries',
    });
  });

  it('truncates when the injected clock exceeds the time budget', async () => {
    const ticks = [0, 0, 31];

    await expect(
      collectWithBudget(paths(['a.ts', 'b.ts']), {
        maxFiles: 10,
        timeoutMs: 30,
        now: () => ticks.shift() ?? 31,
      })
    ).resolves.toEqual({
      paths: ['a.ts'],
      truncated: true,
      truncateReason: 'timeBudget',
    });
  });

  it('includes work performed before collection in the time budget', async () => {
    await expect(
      collectWithBudget(['a.ts'], {
        maxFiles: 10,
        timeoutMs: 30,
        now: () => 31,
        startTime: 0,
      })
    ).resolves.toEqual({
      paths: [],
      truncated: true,
      truncateReason: 'timeBudget',
    });
  });
});

async function* paths(values: string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value;
  }
}
