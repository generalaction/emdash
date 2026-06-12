import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestVersionService } from './latest-version-service';

const fetchMock = vi.fn<typeof fetch>();

function mockFetch(responseBody: string, status = 200) {
  // Fresh Response per call: a body can only be consumed once.
  fetchMock.mockImplementation(async () => new Response(responseBody, { status }));
}

function mockFetchError(errorMsg: string) {
  fetchMock.mockRejectedValue(new Error(errorMsg));
}

describe('LatestVersionService', () => {
  let service: LatestVersionService;

  beforeEach(() => {
    service = new LatestVersionService();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for releaseSource kind=none', async () => {
    const version = await service.fetchLatestVersion({ kind: 'none' });
    expect(version).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches version from npm registry', async () => {
    mockFetch(JSON.stringify({ version: '2.3.4' }));

    const version = await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(version).toBe('2.3.4');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('registry.npmjs.org'),
      expect.anything()
    );
  });

  it('fetches version from github releases, stripping v prefix', async () => {
    mockFetch(JSON.stringify({ tag_name: 'v1.5.0' }));

    const version = await service.fetchLatestVersion({
      kind: 'github',
      repo: 'anthropics/claude-code',
    });

    expect(version).toBe('1.5.0');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.anything()
    );
  });

  it('returns null and does not throw on network error', async () => {
    mockFetchError('ENOTFOUND');

    const version = await service.fetchLatestVersion({ kind: 'npm', package: 'codebuff' });

    expect(version).toBeNull();
  });

  it('returns null on HTTP error status', async () => {
    mockFetch('Not Found', 404);

    const version = await service.fetchLatestVersion({ kind: 'npm', package: 'nonexistent-pkg' });

    expect(version).toBeNull();
  });

  it('caches results and does not re-fetch within TTL', async () => {
    mockFetch(JSON.stringify({ version: '1.0.0' }));

    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });
    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache entry and re-fetches', async () => {
    mockFetch(JSON.stringify({ version: '1.0.0' }));

    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });
    service.invalidate({ kind: 'npm', package: '@openai/codex' });
    await service.fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
