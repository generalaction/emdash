import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider as integration } from '../../../integrations/impl/youtrack';
import {
  requestYouTrack,
  verifyYouTrackCredentials,
} from '../../../integrations/impl/youtrack/client';
import {
  youTrackCredentialsSchema,
  youTrackUserSchema,
} from '../../../integrations/impl/youtrack/types';
import { getIssue, listIssues, searchIssues } from './index';

const user = { id: '1-3', login: 'ada', fullName: 'Ada Lovelace' };
const issue = {
  id: '2-31',
  idReadable: 'ENG-123',
  summary: 'Fix authentication',
  description: 'Keep account identity when reconnecting.',
  updated: 1_700_000_000_000,
  project: { name: 'Engineering' },
  customFields: [
    { $type: 'StateIssueCustomField', name: 'Workflow', value: { name: 'In Progress' } },
    { $type: 'SingleUserIssueCustomField', name: 'Assignee', value: { name: 'Ada' } },
    { $type: 'SimpleIssueCustomField', name: 'Estimate', value: 3 },
  ],
};
const requests: { url: URL; authorization: string | undefined }[] = [];
let instanceUrl: string;
let handler: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => {
  requests.push({
    url: new URL(request.url ?? '/', instanceUrl),
    authorization: request.headers.authorization,
  });
  handler(request, response);
});
const log: ConnectedIntegrationHostContext['log'] = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

function host(): ConnectedIntegrationHostContext {
  return { credentials: { instanceUrl, apiToken: 'test-token' }, log };
}

function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  instanceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/youtrack`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  requests.length = 0;
  handler = (_request, response) => json(response, user);
});

describe('YouTrack connection', () => {
  it('verifies real HTTP credentials and scopes identity to the complete installation URL', async () => {
    const result = await verifyYouTrackCredentials({
      instanceUrl: ` ${instanceUrl}/ `,
      apiToken: ' test-token ',
    });
    expect(result).toEqual({
      success: true,
      data: {
        credentials: { instanceUrl, apiToken: 'test-token' },
        account: { id: '1-3', login: 'ada', host: new URL(instanceUrl).host, scope: instanceUrl },
        displayName: 'Ada Lovelace',
        displayDetail: `ada · ${instanceUrl}`,
      },
    });
    expect(requests[0]?.url.pathname).toBe('/youtrack/api/users/me');
    expect(requests[0]?.authorization).toBe('Bearer test-token');
    const other = await verifyYouTrackCredentials({
      instanceUrl: instanceUrl.replace('/youtrack', '/other'),
      apiToken: 'test-token',
    });
    expect(other.success && other.data.account.scope).not.toBe(
      result.success && result.data.account.scope
    );
  });

  it.each([
    'file:///tmp/youtrack',
    'https://user:password@example.com',
    'https://example.com?token=secret',
    'https://example.com/#fragment',
  ])('rejects unsafe instance URL %s before HTTP access', async (url) => {
    const result = await verifyYouTrackCredentials({ instanceUrl: url, apiToken: 'test-token' });
    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('supports both Cloud and self hosted connection configuration and exposes the official icon', () => {
    expect(
      youTrackCredentialsSchema.parse({
        instanceUrl: 'https://team.youtrack.cloud/',
        apiToken: ' perm:token ',
      })
    ).toEqual({
      instanceUrl: 'https://team.youtrack.cloud',
      apiToken: 'perm:token',
    });
    expect(integration.assets.icon?.alt).toBe('YouTrack');
    expect(integration.capabilities.auth.methods[0]?.kind).toBe('form');
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [404, 'not_found_or_no_access'],
    [429, 'rate_limited'],
    [503, 'host_unreachable'],
  ])('maps HTTP %s without exposing the response body', async (status, type) => {
    handler = (_request, response) => json(response, { error: 'secret-token' }, status);
    const result = await listIssues(host(), { limit: 5 });
    expect(result).toMatchObject({ success: false, error: { type } });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('rejects invalid remote responses', async () => {
    handler = (_request, response) => json(response, { id: null });
    expect(await verifyYouTrackCredentials(host().credentials)).toEqual({
      success: false,
      error: { type: 'generic', message: 'YouTrack returned an invalid API response.' },
    });
  });

  it('does not forward tokens through redirects', async () => {
    handler = (_request, response) => {
      response.writeHead(302, { Location: `${instanceUrl}/other` });
      response.end();
    };
    expect((await listIssues(host(), { limit: 5 })).success).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('aborts a stalled HTTP request', async () => {
    handler = () => {};
    await expect(
      requestYouTrack(
        { instanceUrl, apiToken: 'test-token' },
        'users/me',
        { fields: 'id,login,fullName' },
        youTrackUserSchema,
        AbortSignal.timeout(20)
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('YouTrack tickets', () => {
  it('lists unresolved tickets with stable IDs and readable display numbers', async () => {
    handler = (_request, response) => json(response, [issue]);
    const result = await listIssues(host(), { limit: 5 });
    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: '2-31',
          displayIdentifier: 'ENG-123',
          title: issue.summary,
          description: issue.description,
          url: `${instanceUrl}/issue/ENG-123`,
          updatedAt: new Date(issue.updated).toISOString(),
          project: 'Engineering',
          status: 'In Progress',
          assignees: ['Ada'],
        },
      ],
    });
    expect(requests[0]?.url.searchParams.get('query')).toBe('#Unresolved sort by: updated desc');
    expect(requests[0]?.url.searchParams.get('$top')).toBe('5');
    expect(requests).toHaveLength(1);
  });

  it('passes native search queries without appending an unresolved filter', async () => {
    handler = (_request, response) => json(response, []);
    await searchIssues(host(), { searchTerm: ' project: Engineering #Resolved ', limit: 200 });
    expect(requests[0]?.url.searchParams.get('query')).toBe('project: Engineering #Resolved');
    expect(requests[0]?.url.searchParams.get('$top')).toBe('100');
  });

  it('does not request an empty search', async () => {
    expect(await searchIssues(host(), { searchTerm: ' ', limit: 5 })).toEqual({
      success: true,
      data: [],
    });
    expect(requests).toHaveLength(0);
  });

  it('maps missing optional fields and multiple assignees', async () => {
    handler = (_request, response) =>
      json(response, [
        { ...issue, description: null, project: null, customFields: [] },
        {
          ...issue,
          customFields: [
            {
              $type: 'MultiUserIssueCustomField',
              name: 'Assignee',
              value: [{ fullName: 'Ada' }, { login: 'grace' }],
            },
          ],
        },
      ]);
    const result = await listIssues(host(), { limit: 5 });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data[0]).toMatchObject({
      status: undefined,
      assignees: undefined,
      description: undefined,
      project: undefined,
    });
    expect(result.data[1]?.assignees).toEqual(['Ada', 'grace']);
  });

  it('retrieves every comment page, including server-limited short pages, and excludes deleted comments', async () => {
    handler = (request, response) => {
      const url = new URL(request.url ?? '/', instanceUrl);
      if (!url.pathname.endsWith('/comments'))
        return json(response, { ...issue, commentsCount: 3 });
      const skip = url.searchParams.get('$skip');
      json(
        response,
        skip === '0'
          ? [
              {
                id: '4-1',
                text: 'First comment',
                deleted: false,
                created: issue.updated,
                author: { fullName: 'Ada', login: 'ada' },
              },
            ]
          : skip === '1'
            ? [
                {
                  id: '4-2',
                  text: 'Second comment',
                  deleted: false,
                  created: issue.updated,
                  author: null,
                },
                {
                  id: '4-3',
                  text: 'Deleted secret',
                  deleted: true,
                  created: issue.updated,
                  author: null,
                },
              ]
            : []
      );
    };
    const result = await getIssue(host(), { identifier: '2-31' });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.context).toContain('First comment');
    expect(result.data.context).toContain('Second comment');
    expect(result.data.context).not.toContain('Deleted secret');
    expect(requests[1]?.url.searchParams.get('fields')).toContain('author(fullName,login)');
    expect(requests.map(({ url }) => url.searchParams.get('$skip'))).toEqual([null, '0', '1', '3']);
  });

  it('limits context to the latest 100 comments of a long discussion', async () => {
    handler = (request, response) => {
      const url = new URL(request.url ?? '/', instanceUrl);
      if (!url.pathname.endsWith('/comments'))
        return json(response, { ...issue, commentsCount: 250 });
      const skip = Number(url.searchParams.get('$skip'));
      json(
        response,
        Array.from({ length: Math.min(100, 250 - skip) }, (_, index) => ({
          id: `4-${skip + index}`,
          text: `Comment ${skip + index}`,
          deleted: false,
          created: issue.updated,
          author: null,
        }))
      );
    };
    const result = await getIssue(host(), { identifier: '2-31' });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.context).toContain('(150 older comments omitted)');
    expect(result.data.context).toContain('Comment 150');
    expect(result.data.context).toContain('Comment 249');
    expect(result.data.context).not.toContain('Comment 149');
    expect(requests.map(({ url }) => url.searchParams.get('$skip'))).toEqual([null, '150', '250']);
  });

  it('reports a failed comment page instead of silently supplying incomplete context', async () => {
    handler = (request, response) =>
      json(
        response,
        request.url?.includes('/comments')
          ? { error: 'Unavailable' }
          : { ...issue, commentsCount: 1 },
        request.url?.includes('/comments') ? 503 : 200
      );
    expect(await getIssue(host(), { identifier: '2-31' })).toMatchObject({
      success: false,
      error: { type: 'host_unreachable' },
    });
  });

  it('rejects invalid ticket paths before accessing HTTP', async () => {
    expect((await getIssue(host(), { identifier: '../users/me' })).success).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
