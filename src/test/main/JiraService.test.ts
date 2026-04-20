import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ClientRequest, IncomingMessage } from 'node:http';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-emdash' },
}));

// Shared mocks for node:http / node:https so we can assert wire-level behavior
// (URLs, headers) for the doRequest path. vi.hoisted is required because
// vi.mock factories are hoisted above top-level statements.
const { httpsRequestMock, httpRequestMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  httpRequestMock: vi.fn(),
}));
vi.mock('node:https', () => ({ request: httpsRequestMock }));
vi.mock('node:http', () => ({ request: httpRequestMock }));

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

/**
 * Fake `https.request` / `http.request` implementation that captures the
 * options passed and immediately resolves the response callback with the
 * provided body + status. Returns a minimal ClientRequest-like object.
 */
function fakeRequest(body = '{}', statusCode = 200) {
  const captured: { options: any; body: string }[] = [];
  const impl = (options: any, cb?: (res: IncomingMessage) => void): ClientRequest => {
    const entry = { options, body: '' };
    captured.push(entry);
    const res: any = {
      statusCode,
      on: (event: string, handler: (...args: any[]) => void) => {
        if (event === 'data') setTimeout(() => handler(Buffer.from(body)), 0);
        if (event === 'end') setTimeout(() => handler(), 1);
        return res;
      },
    };
    setTimeout(() => cb?.(res as IncomingMessage), 0);
    return {
      on: vi.fn(),
      write: (chunk: string) => {
        entry.body += chunk;
      },
      end: vi.fn(),
    } as unknown as ClientRequest;
  };
  return { impl, captured };
}

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
      { id: '1', key: 'GEN-11', fields: { summary: 'Older', updated: '2026-03-02T10:00:00.000Z' } },
      {
        id: '2',
        key: 'GEN-12',
        fields: { summary: 'Newest', updated: '2026-03-04T10:00:00.000Z' },
      },
      { id: '3', key: 'GEN-13', fields: { summary: 'Unknown', updated: null } },
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
      { id: '12', key: 'GEN-23', fields: { summary: 'Bad date', updated: 'not-a-date' } },
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
      { id: '22', key: 'GEN-33', fields: { summary: 'No date', updated: null } },
    ];
    searchRawSpy.mockResolvedValue(issues);

    const result = await service.searchIssues('query', 20);

    expect(result.map((issue) => issue.key)).toEqual(['GEN-32', 'GEN-31', 'GEN-33']);
    expect(requireAuthSpy).toHaveBeenCalled();
  });
});

describe('JiraService wire-level auth behavior', () => {
  beforeEach(() => {
    httpsRequestMock.mockReset();
    httpRequestMock.mockReset();
  });

  it('sends Basic header and /rest/api/3 path for Cloud (basic) auth', async () => {
    const { impl, captured } = fakeRequest('{"displayName":"Me"}');
    httpsRequestMock.mockImplementation(impl);

    const service = new JiraService() as unknown as {
      getMyself: (siteUrl: string, auth: Auth) => Promise<any>;
    };
    await service.getMyself('https://acme.atlassian.net', {
      authType: 'basic',
      email: 'me@acme.com',
      token: 'abc',
    });

    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(captured[0].options.path).toBe('/rest/api/3/myself');
    const expected = `Basic ${Buffer.from('me@acme.com:abc').toString('base64')}`;
    expect(captured[0].options.headers.Authorization).toBe(expected);
  });

  it('sends Bearer header and /rest/api/2 path for Server/DC (bearer) auth', async () => {
    const { impl, captured } = fakeRequest('{"displayName":"OnPrem"}');
    httpsRequestMock.mockImplementation(impl);

    const service = new JiraService() as unknown as {
      getMyself: (siteUrl: string, auth: Auth) => Promise<any>;
    };
    await service.getMyself('https://jira.mycorp.com', {
      authType: 'bearer',
      token: 'my-pat',
    });

    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(captured[0].options.headers.Authorization).toBe('Bearer my-pat');
    expect(captured[0].options.path).toBe('/rest/api/2/myself');
  });

  it('preserves context path for Server/DC instances mounted under a subdirectory', async () => {
    const { impl, captured } = fakeRequest('{"displayName":"CtxPath"}');
    httpsRequestMock.mockImplementation(impl);

    const service = new JiraService() as unknown as {
      getMyself: (siteUrl: string, auth: Auth) => Promise<any>;
    };
    await service.getMyself('https://intranet.corp.com/jira', {
      authType: 'bearer',
      token: 't',
    });

    // The old `new URL('/path', base)` form dropped "/jira" — buildUrl must keep it
    expect(captured[0].options.path).toBe('/jira/rest/api/2/myself');
    expect(captured[0].options.hostname).toBe('intranet.corp.com');
  });

  it('passes explicit port and selects http transport for http:// URLs', async () => {
    const { impl, captured } = fakeRequest('{"displayName":"Dev"}');
    httpRequestMock.mockImplementation(impl);

    const service = new JiraService() as unknown as {
      getMyself: (siteUrl: string, auth: Auth) => Promise<any>;
    };
    await service.getMyself('http://jira.internal:8080/jira', {
      authType: 'bearer',
      token: 't',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(captured[0].options.port).toBe(8080);
    expect(captured[0].options.protocol).toBe('http:');
    expect(captured[0].options.path).toBe('/jira/rest/api/2/myself');
  });
});
