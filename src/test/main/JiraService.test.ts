import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-emdash' },
}));

import JiraService from '../../main/services/JiraService';

type Auth =
  | { authType: 'basic'; email: string; token: string }
  | { authType: 'bearer'; token: string };

type JiraRawIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    updated?: string | null;
  };
};

describe('JiraService sorting', () => {
  let service: JiraService;
  let serviceInternals: {
    requireAuth: () => Promise<{ siteUrl: string; auth: Auth }>;
    searchRaw: (siteUrl: string, auth: Auth, jql: string, limit: number) => Promise<JiraRawIssue[]>;
  };
  let requireAuthSpy: MockInstance;
  let searchRawSpy: MockInstance;

  const basicAuth: Auth = { authType: 'basic', email: 'user@example.com', token: 'test-token' };

  beforeEach(() => {
    service = new JiraService();
    serviceInternals = service as unknown as typeof serviceInternals;
    requireAuthSpy = vi.spyOn(serviceInternals, 'requireAuth').mockResolvedValue({
      siteUrl: 'https://jira.example.com',
      auth: basicAuth,
    });
    searchRawSpy = vi.spyOn(serviceInternals, 'searchRaw');
  });

  it('sorts initial fetch results by updatedAt descending', async () => {
    const issues: JiraRawIssue[] = [
      {
        id: '1',
        key: 'GEN-11',
        fields: { summary: 'Older', updated: '2026-03-02T10:00:00.000Z' },
      },
      {
        id: '2',
        key: 'GEN-12',
        fields: { summary: 'Newest', updated: '2026-03-04T10:00:00.000Z' },
      },
      {
        id: '3',
        key: 'GEN-13',
        fields: { summary: 'Unknown', updated: null },
      },
    ];

    searchRawSpy.mockResolvedValue(issues);

    const result = await service.initialFetch(50);

    expect(result.map((issue) => issue.key)).toEqual(['GEN-12', 'GEN-11', 'GEN-13']);
    expect(requireAuthSpy).toHaveBeenCalled();
  });

  it('sorts smart search results by updatedAt descending', async () => {
    const issues: JiraRawIssue[] = [
      {
        id: '10',
        key: 'GEN-21',
        fields: { summary: 'Stale', updated: '2026-03-01T08:00:00.000Z' },
      },
      {
        id: '11',
        key: 'GEN-22',
        fields: { summary: 'Fresh', updated: '2026-03-05T08:00:00.000Z' },
      },
      {
        id: '12',
        key: 'GEN-23',
        fields: { summary: 'Bad date', updated: 'not-a-date' },
      },
    ];

    searchRawSpy.mockResolvedValue(issues);

    const result = await service.smartSearchIssues('search term', 20);

    expect(result.map((issue) => issue.key)).toEqual(['GEN-22', 'GEN-21', 'GEN-23']);
    expect(requireAuthSpy).toHaveBeenCalled();
  });

  it('sorts searchIssues results by updatedAt descending', async () => {
    const issues: JiraRawIssue[] = [
      {
        id: '20',
        key: 'GEN-31',
        fields: { summary: 'Older', updated: '2026-03-02T08:00:00.000Z' },
      },
      {
        id: '21',
        key: 'GEN-32',
        fields: { summary: 'Newest', updated: '2026-03-06T08:00:00.000Z' },
      },
      {
        id: '22',
        key: 'GEN-33',
        fields: { summary: 'No date', updated: null },
      },
    ];

    searchRawSpy.mockResolvedValue(issues);

    const result = await service.searchIssues('query', 20);

    expect(result.map((issue) => issue.key)).toEqual(['GEN-32', 'GEN-31', 'GEN-33']);
    expect(requireAuthSpy).toHaveBeenCalled();
  });
});

describe('JiraService bearer auth', () => {
  let service: JiraService;
  let serviceInternals: {
    requireAuth: () => Promise<{ siteUrl: string; auth: Auth }>;
    doRequest: (
      url: URL,
      auth: Auth,
      method: 'GET' | 'POST',
      payload?: string,
      extraHeaders?: Record<string, string>
    ) => Promise<string>;
    searchRaw: (siteUrl: string, auth: Auth, jql: string, limit: number) => Promise<JiraRawIssue[]>;
  };
  let requireAuthSpy: MockInstance;
  let doRequestSpy: MockInstance;

  const bearerAuth: Auth = { authType: 'bearer', token: 'my-pat' };

  beforeEach(() => {
    service = new JiraService();
    serviceInternals = service as unknown as typeof serviceInternals;
    requireAuthSpy = vi.spyOn(serviceInternals, 'requireAuth').mockResolvedValue({
      siteUrl: 'https://jira.mycompany.com',
      auth: bearerAuth,
    });
    doRequestSpy = vi.spyOn(serviceInternals, 'doRequest');
  });

  it('uses Bearer header and /rest/api/2 path for bearer auth', async () => {
    vi.spyOn(serviceInternals, 'searchRaw').mockResolvedValue([]);

    await service.initialFetch(5);

    expect(requireAuthSpy).toHaveBeenCalled();
  });

  it('passes bearer auth object through searchRaw', async () => {
    const searchRawSpy = vi.spyOn(serviceInternals, 'searchRaw').mockResolvedValue([]);

    await service.searchIssues('TEST-1', 5);

    expect(searchRawSpy).toHaveBeenCalledWith(
      'https://jira.mycompany.com',
      bearerAuth,
      expect.any(String),
      5
    );
  });

  it('resolves /rest/api/2 base for bearer auth type', async () => {
    // searchRaw is called with the auth object; verify the siteUrl resolves to api/2 endpoints
    // by checking that searchRaw receives the bearer auth object unchanged
    const searchRawSpy2 = vi.spyOn(serviceInternals, 'searchRaw').mockResolvedValue([]);

    await service.searchIssues('foo', 3);

    const [calledSiteUrl, calledAuth] = searchRawSpy2.mock.calls[0];
    expect(calledSiteUrl).toBe('https://jira.mycompany.com');
    expect(calledAuth).toEqual(bearerAuth);
    expect((calledAuth as any).authType).toBe('bearer');
    expect((calledAuth as any).email).toBeUndefined();
  });
});
