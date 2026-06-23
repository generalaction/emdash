import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { SettingsStore } from './settings-service';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

describe('SettingsStore conversationUi', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('returns the terminal default when nothing is stored', async () => {
    const store = new SettingsStore();
    await expect(store.get('conversationUi')).resolves.toEqual({ mode: 'terminal' });
  });

  it('persists native-chat and reads it back', async () => {
    const store = new SettingsStore();
    await store.update('conversationUi', { mode: 'native-chat' });
    await expect(store.get('conversationUi')).resolves.toEqual({ mode: 'native-chat' });

    // A fresh store (no cache) sees the same persisted value.
    await expect(new SettingsStore().get('conversationUi')).resolves.toEqual({
      mode: 'native-chat',
    });
  });

  it('stores only the delta and clears it when set back to the default', async () => {
    const store = new SettingsStore();
    await store.update('conversationUi', { mode: 'native-chat' });
    let rows = fixture.sqlite
      .prepare(`SELECT value FROM app_settings WHERE key = 'conversationUi'`)
      .all() as Array<{ value: string }>;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].value)).toEqual({ mode: 'native-chat' });

    await store.update('conversationUi', { mode: 'terminal' });
    rows = fixture.sqlite
      .prepare(`SELECT value FROM app_settings WHERE key = 'conversationUi'`)
      .all() as Array<{ value: string }>;
    expect(rows).toHaveLength(0);
    await expect(store.get('conversationUi')).resolves.toEqual({ mode: 'terminal' });
  });

  it('ignores stale per-provider keys from the earlier schema', async () => {
    fixture.sqlite
      .prepare(`INSERT INTO app_settings (key, value) VALUES ('conversationUi', ?)`)
      .run(JSON.stringify({ codex: 'native-chat' }));
    const store = new SettingsStore();
    const value = await store.get('conversationUi');
    expect(value.mode).toBe('terminal');
  });

  it('rejects invalid modes', async () => {
    const store = new SettingsStore();
    await expect(store.update('conversationUi', { mode: 'hologram' } as never)).rejects.toThrow();
  });
});
