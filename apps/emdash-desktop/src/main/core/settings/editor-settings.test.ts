import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_FONT_SIZE_DEFAULT } from '@shared/core/editor/editor-settings';

const storedSettings = vi.hoisted(() => new Map<string, string>());

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column, value) => ({ column, value })),
}));

vi.mock('@main/db/schema', () => ({
  appSettings: { key: 'key', value: 'value' },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate: { value: string }) => ({
          execute: vi.fn(async () => {
            const value = storedSettings.get(predicate.value);
            return value === undefined ? [] : [{ key: predicate.value, value }];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: { key: string; value: string }) => ({
        onConflictDoUpdate: vi.fn(() => ({
          execute: vi.fn(async () => {
            storedSettings.set(row.key, row.value);
          }),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((predicate: { value: string }) => ({
        execute: vi.fn(async () => {
          storedSettings.delete(predicate.value);
        }),
      })),
    })),
  },
}));

const { SettingsStore } = await import('./settings-service');

describe('editor settings persistence', () => {
  beforeEach(() => {
    storedSettings.clear();
  });

  it('supplies defaults when upgrading an existing database with no editor row', async () => {
    const settings = new SettingsStore();

    await expect(settings.getAll()).resolves.toMatchObject({
      editor: { fontSize: EDITOR_FONT_SIZE_DEFAULT },
    });
  });

  it('stores editor preferences independently and removes the row after reset', async () => {
    const settings = new SettingsStore();

    await settings.update('editor', { fontFamily: 'JetBrains Mono', fontSize: 16 });

    expect(JSON.parse(storedSettings.get('editor') ?? '{}')).toEqual({
      fontFamily: 'JetBrains Mono',
      fontSize: 16,
    });

    await settings.update('editor', { fontSize: EDITOR_FONT_SIZE_DEFAULT });

    expect(storedSettings.has('editor')).toBe(false);
  });
});
