import { beforeEach, describe, expect, it } from 'vitest';
import { json, createYouTrackTestServer } from '../../../integrations/impl/youtrack/test-utils';
import { getIssue, listIssues, searchIssues } from './index';

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

const http = createYouTrackTestServer();
const { requests, host } = http;
let instanceUrl: string;

beforeEach(() => {
  instanceUrl = http.instanceUrl;
});

describe('YouTrack tickets', () => {
  it('lists unresolved tickets with stable IDs and readable display numbers', async () => {
    http.handler = (_request, response) => json(response, [issue]);
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
    expect(requests[0]?.url.pathname).toBe('/youtrack/api/issues');
    expect(requests[0]?.url.searchParams.get('fields')).toBe(
      'id,idReadable,summary,description,updated,project(name),customFields($type,name,value(name,fullName,login))'
    );
    expect(requests[0]?.url.searchParams.get('$top')).toBe('5');
    expect(requests).toHaveLength(1);
  });

  it.each(['project: Engineering #Resolved', 'project: {R&D} summary: "a+b & c?" #Resolved'])(
    'preserves native search query %s',
    async (query) => {
      http.handler = (_request, response) => json(response, []);
      await searchIssues(host(), { searchTerm: ` ${query} `, limit: 200 });
      expect(requests[0]?.url.searchParams.get('query')).toBe(query);
      expect(requests[0]?.url.searchParams.get('$top')).toBe('100');
    }
  );

  it('validates issue responses returned by the SDK', async () => {
    http.handler = (_request, response) => json(response, [{ ...issue, summary: null }]);
    expect(await listIssues(host(), { limit: 5 })).toEqual({
      success: false,
      error: { type: 'generic', message: 'YouTrack returned an invalid API response.' },
    });
  });

  it('does not request an empty search', async () => {
    expect(await searchIssues(host(), { searchTerm: ' ', limit: 5 })).toEqual({
      success: true,
      data: [],
    });
    expect(requests).toHaveLength(0);
  });

  it('maps missing optional fields and multiple assignees', async () => {
    http.handler = (_request, response) =>
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
    http.handler = (request, response) => {
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
    expect(requests[0]?.url.pathname).toBe('/youtrack/api/issues/2-31');
    expect(requests[0]?.url.searchParams.get('fields')).toContain('commentsCount');
    expect(requests.slice(1).map(({ url }) => url.pathname)).toEqual([
      '/youtrack/api/issues/2-31/comments',
      '/youtrack/api/issues/2-31/comments',
      '/youtrack/api/issues/2-31/comments',
    ]);
    expect(requests[1]?.url.searchParams.get('fields')).toContain('author(fullName,login)');
    expect(requests.map(({ url }) => url.searchParams.get('$skip'))).toEqual([null, '0', '1', '3']);
  });

  it('limits context to the latest 100 comments of a long discussion', async () => {
    http.handler = (request, response) => {
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
    http.handler = (request, response) =>
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

  it('encodes ticket identifiers as one path segment for issues and comments', async () => {
    http.handler = (request, response) =>
      json(response, request.url?.includes('/comments') ? [] : { ...issue, commentsCount: 0 });
    const result = await getIssue(host(), { identifier: 'ENG%2F-123' });
    expect(result.success).toBe(true);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/youtrack/api/issues/ENG%252F-123',
      '/youtrack/api/issues/ENG%252F-123/comments',
    ]);
  });
});
