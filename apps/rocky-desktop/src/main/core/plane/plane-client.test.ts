import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaneClient, type PlaneHttpError } from './plane-client';

describe('PlaneClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('builds URLs from a self-hosted base path and sends X-API-Key', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [] }),
    });
    vi.stubGlobal('fetch', fetch);

    const client = new PlaneClient('https://plane.example.com/custom', 'plane_api_token');
    await client.searchWorkItems('my team', 'dark mode', 20);

    const url = fetch.mock.calls[0]?.[0] as URL;
    const options = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> };

    expect(url.toString()).toBe(
      'https://plane.example.com/custom/api/v1/workspaces/my%20team/work-items/search/?search=dark+mode&limit=20&per_page=20&expand=assignees%2Cstate%2Cproject'
    );
    expect(options.headers).toEqual({
      Accept: 'application/json',
      'X-API-Key': 'plane_api_token',
    });
    expect(url.pathname).not.toContain('/issues/');
  });

  it('parses paginated work item responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ id: 'item-1', name: 'Fix login', sequence_id: 42 }],
        }),
      })
    );

    const client = new PlaneClient('https://api.plane.so', 'token');
    const items = await client.listWorkItems('workspace', 'project-id', 10);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        name: 'Fix login',
        sequence_id: 42,
      }),
    ]);
  });

  it('throws a sanitized PlaneHttpError for failed requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ error: 'Invalid API key' }),
      })
    );

    const client = new PlaneClient('https://api.plane.so', 'secret-token');

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      status: 401,
      message: 'Invalid API key',
    } satisfies Partial<PlaneHttpError>);
  });
});
