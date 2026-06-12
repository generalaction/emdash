import * as https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestVersionService } from './latest-version-service';

vi.mock('node:https');

function mockHttpsGet(responseBody: string, statusCode = 200) {
  vi.mocked(https.get).mockImplementation((_url, _opts, callback) => {
    const cb = typeof _opts === 'function' ? _opts : callback;
    if (!cb) return {} as ReturnType<typeof https.get>;

    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const res = {
      statusCode,
      headers: {},
      on: (event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
        return res;
      },
    };
    cb(res as never);
    // Emit data and end
    listeners['data']?.forEach((h) => h(responseBody));
    listeners['end']?.forEach((h) => h());

    const req = {
      on: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    };
    return req as unknown as ReturnType<typeof https.get>;
  });
}

function mockHttpsGetError(errorMsg: string) {
  vi.mocked(https.get).mockImplementation((_url, _opts, callback) => {
    const cb = typeof _opts === 'function' ? _opts : callback;
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const res = {
      statusCode: 200,
      headers: {},
      on: (event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
        return res;
      },
    };
    if (cb) cb(res as never);

    const req = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') handler(new Error(errorMsg));
        return req;
      },
      setTimeout: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    };
    return req as unknown as ReturnType<typeof https.get>;
  });
}

describe('LatestVersionService', () => {
  let service: LatestVersionService;

  beforeEach(() => {
    service = new LatestVersionService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for releaseSource kind=none', async () => {
    const version = await service.fetchLatestVersion({ kind: 'none' });
    expect(version).toBeNull();
    expect(https.get).not.toHaveBeenCalled();
  });

  it('fetches version from npm registry', async () => {
    mockHttpsGet(JSON.stringify({ version: '2.3.4' }));

    const version = await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(version).toBe('2.3.4');
    expect(https.get).toHaveBeenCalledWith(
      expect.stringContaining('registry.npmjs.org'),
      expect.anything(),
      expect.any(Function)
    );
  });

  it('fetches version from github releases, stripping v prefix', async () => {
    mockHttpsGet(JSON.stringify({ tag_name: 'v1.5.0' }));

    const version = await service.fetchLatestVersion({
      kind: 'github',
      repo: 'anthropics/claude-code',
    });

    expect(version).toBe('1.5.0');
    expect(https.get).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.anything(),
      expect.any(Function)
    );
  });

  it('returns null and does not throw on network error', async () => {
    mockHttpsGetError('ENOTFOUND');

    const version = await service.fetchLatestVersion({ kind: 'npm', package: 'codebuff' });

    expect(version).toBeNull();
  });

  it('returns null on HTTP error status', async () => {
    mockHttpsGet('Not Found', 404);

    const version = await service.fetchLatestVersion({ kind: 'npm', package: 'nonexistent-pkg' });

    expect(version).toBeNull();
  });

  it('caches results and does not re-fetch within TTL', async () => {
    mockHttpsGet(JSON.stringify({ version: '1.0.0' }));

    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });
    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(https.get).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache entry and re-fetches', async () => {
    mockHttpsGet(JSON.stringify({ version: '1.0.0' }));

    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });
    service.invalidate({ kind: 'npm', package: '@openai/codex' });
    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(https.get).toHaveBeenCalledTimes(2);
  });
});
