import { beforeEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';

const mocks = vi.hoisted(() => {
  const state = {
    rows: [] as Array<{ value: string }>,
  };

  return {
    state,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            execute: vi.fn(async () => state.rows),
          })),
        })),
      })),
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
}));

vi.mock('@emdash/shared', () => ({
  isDeepEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
}));

vi.mock('@main/db/client', () => ({
  db: mocks.db,
}));

vi.mock('@main/db/schema', () => ({
  appSettings: {
    key: 'key',
    value: 'value',
  },
}));

const { OverrideSettings } = await import('./override-settings');

describe('OverrideSettings', () => {
  beforeEach(() => {
    mocks.state.rows = [];
    vi.clearAllMocks();
  });

  it('returns metadata for stored overrides without external defaults', async () => {
    mocks.state.rows = [
      {
        value: JSON.stringify({
          codex: { env: { OPENAI_API_KEY: 'key' } },
        }),
      },
    ];

    const settings = new OverrideSettings(
      'providerConfigs',
      () => ({}),
      z.object({
        env: z.record(z.string(), z.string()).optional(),
      })
    );

    await expect(settings.getItemWithMeta('codex')).resolves.toEqual({
      value: { env: { OPENAI_API_KEY: 'key' } },
      defaults: {},
      overrides: { env: { OPENAI_API_KEY: 'key' } },
    });
  });
});
