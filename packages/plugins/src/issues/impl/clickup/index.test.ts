import type { Logger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const log: Logger = {
  level: 'error',
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => log,
};
const host = { log, credentials: { apiKey: 'pk_test', workspaceId: '421', userId: '72' } };
const issues = provider.behavior.issues;
if (!issues) throw new Error('ClickUp issues are not registered.');
const fetchMock = vi.fn<typeof fetch>();

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: '86abc123',
    custom_id: 'HGAI-2316',
    team_id: '421',
    name: 'Fix login redirect',
    markdown_description: '## Acceptance criteria\n- Keep the return URL',
    status: { status: 'in progress', type: 'custom' },
    assignees: [{ id: 72, username: 'Hung' }],
    folder: { name: 'Platform', hidden: false },
    list: { name: 'Sprint 1' },
    date_updated: '0',
    ...overrides,
  };
}
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
function requestUrl(index = 0) {
  return new URL(String(fetchMock.mock.calls[index]?.[0]));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('ClickUp issue picker', () => {
  it('lists my open tasks with recognizable IDs, context and branch names', async () => {
    respond({ tasks: [task()] });
    expect(await issues.listIssues(host, { limit: 50 })).toEqual({
      success: true,
      data: [
        {
          identifier: 'HGAI-2316',
          title: 'Fix login redirect',
          description: '## Acceptance criteria\n- Keep the return URL',
          url: 'https://app.clickup.com/t/86abc123',
          status: 'in progress',
          assignees: ['Hung'],
          project: 'Platform / Sprint 1',
          updatedAt: '1970-01-01T00:00:00.000Z',
          branchName: 'HGAI-2316-Fix login redirect',
        },
      ],
    });
    expect(requestUrl().pathname).toBe('/api/v2/team/421/task');
    expect(requestUrl().searchParams.get('assignees[]')).toBe('72');
    expect(requestUrl().searchParams.get('include_closed')).toBe('false');
    expect(requestUrl().searchParams.get('subtasks')).toBe('true');
    expect(requestUrl().searchParams.get('order_by')).toBe('updated');
    expect(requestUrl().searchParams.get('reverse')).toBe('true');
  });

  it('searches descriptions on later pages, without an unsupported API search parameter', async () => {
    respond({
      tasks: Array.from({ length: 100 }, (_, i) =>
        task({ id: `old${i}`, custom_id: null, name: 'Old task', markdown_description: '' })
      ),
    });
    respond({ tasks: [task()] });
    const result = await issues.searchIssues(host, { limit: 20, searchTerm: ' RETURN url ' });
    expect(result).toMatchObject({ success: true, data: [{ identifier: 'HGAI-2316' }] });
    expect(requestUrl(1).searchParams.get('page')).toBe('1');
    expect(requestUrl().searchParams.has('search')).toBe(false);
  });

  it('falls back to keyword search for short words that are not task IDs', async () => {
    respond({}, 404);
    respond({ tasks: [task({ name: 'Fix S3 uploads' })] });
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: 'S3' })).toMatchObject({
      success: true,
      data: [{ title: 'Fix S3 uploads' }],
    });
    expect(requestUrl(1).pathname).toBe('/api/v2/team/421/task');
  });

  it.each(['9hz', 'abcdefgh'])(
    'looks up the bare internal ID %s outside assigned tasks',
    async (id) => {
      respond(
        task({ id, custom_id: null, assignees: [], status: { status: 'closed', type: 'closed' } })
      );
      expect(await issues.searchIssues(host, { limit: 20, searchTerm: id })).toMatchObject({
        success: true,
        data: [{ identifier: id, status: 'closed' }],
      });
      expect(requestUrl().pathname).toBe(`/api/v2/task/${id}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('falls back to keywords when an ID-like word has no exact match', async () => {
    respond({}, 404);
    respond({ tasks: [task({ name: 'Update release2026 notes' })] });
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: 'release2026' })).toMatchObject(
      {
        success: true,
        data: [{ title: 'Update release2026 notes' }],
      }
    );
    expect(requestUrl(1).pathname).toBe('/api/v2/team/421/task');
  });

  it('still searches keywords when an ambiguous ID is inaccessible', async () => {
    respond({}, 403);
    respond({ tasks: [task({ name: 'Fix uploads' })] });
    expect(await issues.searchIssues(host, { searchTerm: 'uploads', limit: 20 })).toMatchObject({
      success: true,
      data: [{ title: 'Fix uploads' }],
    });
    expect(requestUrl(1).pathname).toBe('/api/v2/team/421/task');
  });

  it('reports invalid credentials when both the bare lookup and keyword search reject access', async () => {
    respond({}, 401);
    respond({}, 401);
    expect(await issues.searchIssues(host, { searchTerm: 'uploads', limit: 20 })).toMatchObject({
      success: false,
      error: { type: 'auth_failed' },
    });
  });

  it('bounds keyword searches to 500 tasks and returns no fabricated matches', async () => {
    for (let page = 0; page < 5; page += 1) {
      respond({ tasks: Array.from({ length: 100 }, (_, i) => task({ id: `${page}task${i}` })) });
    }
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: 'unmatched phrase' })).toEqual({
      success: true,
      data: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('respects limits and removes duplicate, archived and closed list entries', async () => {
    respond({
      tasks: [
        task({ archived: true }),
        task({ status: { status: 'closed', type: 'closed' } }),
        task(),
        task(),
        task({ id: 'other123', custom_id: null }),
      ],
    });
    expect(await issues.listIssues(host, { limit: 1 })).toMatchObject({
      success: true,
      data: [{ identifier: 'HGAI-2316' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([' hgai-2316 ', 'https://app.clickup.com/t/421/HGAI-2316'])(
    'finds custom IDs directly: %s',
    async (searchTerm) => {
      respond(task({ status: { status: 'closed', type: 'closed' } }));
      expect(await issues.searchIssues(host, { limit: 20, searchTerm })).toMatchObject({
        success: true,
        data: [{ identifier: 'HGAI-2316', status: 'closed' }],
      });
      expect(requestUrl().pathname).toBe('/api/v2/task/HGAI-2316');
      expect(requestUrl().searchParams.get('custom_task_ids')).toBe('true');
      expect(requestUrl().searchParams.get('team_id')).toBe('421');
      expect(requestUrl().searchParams.has('assignees[]')).toBe(false);
    }
  );

  it('accepts internal task URLs and falls back to internal IDs when no custom ID exists', async () => {
    respond(
      task({ custom_id: null, date_updated: 'bad', folder: { name: 'hidden', hidden: true } })
    );
    expect(
      await issues.searchIssues(host, {
        limit: 20,
        searchTerm: 'https://app.clickup.com/t/86abc123?view=details',
      })
    ).toMatchObject({
      success: true,
      data: [{ identifier: '86abc123', updatedAt: undefined, project: 'Sprint 1' }],
    });
    expect(requestUrl().searchParams.has('custom_task_ids')).toBe(false);
  });

  it('fetches full Markdown, checklist and subtask context for the selected ticket', async () => {
    respond(
      task({
        priority: { priority: 'high' },
        parent: 'parent123',
        checklists: [
          {
            name: 'Release checks',
            items: [
              { name: 'Add test', resolved: false },
              { name: 'Reproduce', resolved: true },
            ],
          },
        ],
        subtasks: [{ id: 'sub123', custom_id: 'HGAI-2317', name: 'Write test' }],
      })
    );
    const result = await issues.getIssue?.(host, { identifier: 'HGAI-2316' });
    expect(result?.success).toBe(true);
    if (!result?.success) throw new Error('Expected issue context');
    expect(result.data.description).toContain('Acceptance criteria');
    expect(result.data.context).toContain('## Acceptance criteria\n- Keep the return URL');
    expect(result.data.context).toContain('Priority: high');
    expect(result.data.context).toContain('- [ ] Add test');
    expect(result.data.context).toContain('- [x] Reproduce');
    expect(result.data.context).toContain('HGAI-2317: Write test');
    expect(requestUrl().searchParams.get('include_markdown_description')).toBe('true');
    expect(requestUrl().searchParams.get('include_subtasks')).toBe('true');
  });

  it('does not attach a task from a different workspace', async () => {
    respond(task({ team_id: '999' }));
    expect(await issues.getIssue?.(host, { identifier: '86abc123' })).toMatchObject({
      success: false,
      error: { type: 'not_found_or_no_access' },
    });
  });

  it('rejects workspace-qualified task URLs from a different workspace before lookup', async () => {
    const identifier = 'https://app.clickup.com/t/999/HGAI-2316';
    expect(await issues.getIssue?.(host, { identifier })).toMatchObject({
      success: false,
      error: { type: 'not_found_or_no_access' },
    });
    expect(await issues.searchIssues(host, { searchTerm: identifier, limit: 20 })).toEqual({
      success: true,
      data: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects untrusted URLs without making a network request', async () => {
    expect(
      await issues.getIssue?.(host, { identifier: 'https://evil.example/t/86abc123' })
    ).toMatchObject({ success: false, error: { type: 'invalid_input' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes empty exact searches from rate limits and authorization failures', async () => {
    respond({}, 404);
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: 'HGAI-999' })).toEqual({
      success: true,
      data: [],
    });
    respond({}, 429);
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: 'HGAI-999' })).toMatchObject({
      success: false,
      error: { type: 'rate_limited' },
    });
    respond({}, 403);
    expect(await issues.listIssues(host, { limit: 50 })).toMatchObject({
      success: false,
      error: { type: 'auth_failed' },
    });
  });

  it('returns no results for an empty query and fails closed for missing normalized credentials', async () => {
    expect(await issues.searchIssues(host, { limit: 20, searchTerm: ' ' })).toEqual({
      success: true,
      data: [],
    });
    expect(
      await issues.listIssues({ log, credentials: { apiKey: 'pk_test' } }, { limit: 20 })
    ).toMatchObject({ success: false, error: { type: 'invalid_input' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
