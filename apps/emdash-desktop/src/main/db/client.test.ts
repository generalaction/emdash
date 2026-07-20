import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDrizzleClient: vi.fn(),
}));

vi.mock('./drizzleClient', () => ({
  createDrizzleClient: mocks.createDrizzleClient,
}));

import { db, sqlite } from './client';

beforeEach(() => {
  mocks.createDrizzleClient.mockReset();
});

it('opens the database only on first client property access', () => {
  const pragma = vi.fn(() => 'ok');
  const select = vi.fn(() => 'selected');
  mocks.createDrizzleClient.mockReturnValue({
    sqlite: { pragma },
    db: { select },
    close: vi.fn(),
  });

  expect(mocks.createDrizzleClient).not.toHaveBeenCalled();
  expect(sqlite.pragma('busy_timeout')).toBe('ok');
  expect((db as unknown as { select(): string }).select()).toBe('selected');
  expect(mocks.createDrizzleClient).toHaveBeenCalledTimes(1);
  expect(pragma).toHaveBeenCalledWith('busy_timeout');
});
