import type { Logger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationCredentials } from '../../host';
import { provider } from './index';

const log: Logger = {
  level: 'error',
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => log,
};
const auth = provider.behavior.auth;
if (!auth) throw new Error('ClickUp auth is not registered.');

const fetchMock = vi.fn<typeof fetch>();
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
function account(teams = [{ id: '421', name: 'Example workspace' }]) {
  respond({ user: { id: 72, username: 'Hung' } });
  respond({ teams });
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('ClickUp account connection', () => {
  it('verifies the token, selects a sole workspace and persists the user ID for assigned tasks', async () => {
    vi.stubGlobal('fetch', fetchMock);
    account();
    expect(await auth.verify({ log }, { apiKey: ' pk_test ' })).toEqual({
      connected: true,
      account: { id: '421:72' },
      displayName: 'Hung',
      displayDetail: 'Example workspace',
      credentials: { apiKey: 'pk_test', workspaceId: '421', userId: '72' },
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.clickup.com/api/v2/user',
      'https://api.clickup.com/api/v2/team',
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'pk_test' },
    });
  });

  it('requires a choice rather than guessing when several workspaces are visible', async () => {
    vi.stubGlobal('fetch', fetchMock);
    account([
      { id: '1', name: 'Work' },
      { id: '2', name: 'Personal' },
    ]);
    expect(await auth.verify({ log }, { apiKey: 'pk_test' })).toEqual({
      connected: false,
      error: 'Enter a Workspace ID from the workspaces you can access: Work (1), Personal (2).',
    });
  });

  it('uses an explicitly selected workspace and ignores caller-supplied user IDs', async () => {
    vi.stubGlobal('fetch', fetchMock);
    account([
      { id: '1', name: 'Work' },
      { id: '2', name: 'Personal' },
    ]);
    expect(
      await auth.verify({ log }, { apiKey: 'pk_test', workspaceId: ' 2 ', userId: '999' })
    ).toMatchObject({
      connected: true,
      account: { id: '2:72' },
      credentials: { workspaceId: '2', userId: '72' },
    });
  });

  it('rejects malformed upstream credentials before the host tries to persist them', async () => {
    vi.stubGlobal('fetch', fetchMock);
    account([{ id: 'not-a-workspace-id', name: 'Workspace' }]);
    expect(await auth.verify({ log }, { apiKey: 'pk_test' })).toEqual({
      connected: false,
      error: 'ClickUp returned an unexpected account.',
    });
  });

  it('rejects an inaccessible workspace', async () => {
    vi.stubGlobal('fetch', fetchMock);
    account();
    expect(await auth.verify({ log }, { apiKey: 'pk_test', workspaceId: '999' })).toMatchObject({
      connected: false,
    });
  });

  it.each<IntegrationCredentials>([{ apiKey: '' }, { apiKey: 'pk_test', workspaceId: '../team' }])(
    'validates input before using the network',
    async (credentials) => {
      vi.stubGlobal('fetch', fetchMock);
      expect(await auth.verify({ log }, credentials)).toMatchObject({ connected: false });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([401, 403, 429, 500])(
    'reports HTTP %s without disclosing response content',
    async (status) => {
      vi.stubGlobal('fetch', fetchMock);
      respond({ err: 'sensitive pk_secret upstream text' }, status);
      const result = await auth.verify({ log }, { apiKey: 'pk_test' });
      expect(result.connected).toBe(false);
      expect(JSON.stringify(result)).not.toContain('pk_secret');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('handles malformed API responses and network failures without exposing secrets', async () => {
    vi.stubGlobal('fetch', fetchMock);
    respond({ unexpected: true });
    expect(await auth.verify({ log }, { apiKey: 'pk_test' })).toEqual({
      connected: false,
      error: 'ClickUp returned an unexpected response.',
    });
    fetchMock.mockRejectedValueOnce(new Error('request headers contain pk_test'));
    const result = await auth.verify({ log }, { apiKey: 'pk_test' });
    expect(result.connected).toBe(false);
    expect(JSON.stringify(result)).not.toContain('pk_test');
  });
});
