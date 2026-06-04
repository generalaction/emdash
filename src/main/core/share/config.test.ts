import { afterEach, describe, expect, it, vi } from 'vitest';

describe('SHARE_CONFIG', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalBaseUrl = process.env.EMDASH_SHARE_BASE_URL;
  const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;
  const originalDbFile = process.env.EMDASH_DB_FILE;

  afterEach(() => {
    vi.resetModules();
    if (originalBaseUrl === undefined) {
      delete process.env.EMDASH_SHARE_BASE_URL;
    } else {
      process.env.EMDASH_SHARE_BASE_URL = originalBaseUrl;
    }
    if (originalRendererUrl === undefined) {
      delete env['ELECTRON_RENDERER_URL'];
    } else {
      env['ELECTRON_RENDERER_URL'] = originalRendererUrl;
    }
    if (originalDbFile === undefined) {
      delete env['EMDASH_DB_FILE'];
    } else {
      env['EMDASH_DB_FILE'] = originalDbFile;
    }
  });

  it('prefers EMDASH_SHARE_BASE_URL when set', async () => {
    process.env.EMDASH_SHARE_BASE_URL = 'http://127.0.0.1:9000';

    const { getShareBaseUrl } = await import('./config');

    expect(getShareBaseUrl()).toBe('http://127.0.0.1:9000');
  });

  it('uses localhost when running under electron-vite dev', async () => {
    delete process.env.EMDASH_SHARE_BASE_URL;
    env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

    const { getShareBaseUrl } = await import('./config');

    expect(getShareBaseUrl()).toBe('http://localhost:8787');
  });

  it('uses localhost when running with the local dev database', async () => {
    delete process.env.EMDASH_SHARE_BASE_URL;
    env['EMDASH_DB_FILE'] = '/repo/tooling/db/dev.db';

    const { getShareBaseUrl } = await import('./config');

    expect(getShareBaseUrl()).toBe('http://localhost:8787');
  });
});
