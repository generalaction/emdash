import { err, ok } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { clickUpRequest, readClickUpCredentials } from '../../../integrations/impl/clickup/client';
import {
  clickUpTaskPageSchema,
  clickUpTaskSchema,
  type ClickUpCredentials,
} from '../../../integrations/impl/clickup/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueData,
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { toIssueData, toIssueDetail } from './mapper';

const CUSTOM_ID = /^[a-z][a-z0-9_]*-\d+$/i;
const INTERNAL_ID = /^[a-z0-9]+$/i;
const MAX_SEARCH_PAGES = 5;

function taskReference(input: string): { id: string; workspaceId?: string } | undefined {
  const value = input.trim().replace(/^#/, '');
  if (CUSTOM_ID.test(value)) return { id: value.toUpperCase() };
  if (INTERNAL_ID.test(value)) return { id: value };
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'app.clickup.com') return undefined;
    const match = url.pathname.match(/^\/t\/(?:(\d+)\/)?([^/]+)\/?$/);
    const id = match?.[2];
    if (id && (CUSTOM_ID.test(id) || INTERNAL_ID.test(id))) {
      return { id: CUSTOM_ID.test(id) ? id.toUpperCase() : id, workspaceId: match?.[1] };
    }
  } catch {
    // A title search is not a task URL.
  }
  return undefined;
}

async function fetchTask(
  credentials: ClickUpCredentials,
  identifier: string
): Promise<IssueGetResult> {
  const reference = taskReference(identifier);
  if (!reference)
    return err({
      type: 'invalid_input',
      message: 'Enter a ClickUp task ID or an app.clickup.com task URL.',
    });
  if (reference.workspaceId && reference.workspaceId !== credentials.workspaceId) {
    return err({
      type: 'not_found_or_no_access',
      message: 'This task URL belongs to a different ClickUp workspace.',
    });
  }
  const { id } = reference;
  const params = new URLSearchParams({
    include_markdown_description: 'true',
    include_subtasks: 'true',
  });
  if (CUSTOM_ID.test(id)) {
    params.set('custom_task_ids', 'true');
    params.set('team_id', credentials.workspaceId);
  }
  const result = await clickUpRequest(
    credentials.apiKey,
    `task/${encodeURIComponent(id)}`,
    clickUpTaskSchema,
    params
  );
  if (!result.success) return err(result.error);
  // Direct ID/URL lookup must not silently cross the selected workspace.
  if (result.data.team_id !== credentials.workspaceId) {
    return err({
      type: 'not_found_or_no_access',
      message: 'This task is not in the connected ClickUp workspace.',
    });
  }
  return ok(toIssueDetail(result.data));
}

async function queryAssignedTasks(
  credentials: ClickUpCredentials,
  limit: number,
  term?: string
): Promise<IssueListResult> {
  const issues: IssueData[] = [];
  const seen = new Set<string>();
  // ClickUp has no text-search parameter on this endpoint. Bound read volume
  // rather than crawling a whole workspace; exact IDs use Get Task instead.
  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const params = new URLSearchParams({
      'assignees[]': credentials.userId,
      page: String(page),
      order_by: 'updated',
      reverse: 'true',
      include_closed: 'false',
      subtasks: 'true',
      include_markdown_description: 'true',
    });
    const result = await clickUpRequest(
      credentials.apiKey,
      `team/${credentials.workspaceId}/task`,
      clickUpTaskPageSchema,
      params
    );
    if (!result.success) return err(result.error);
    for (const task of result.data.tasks) {
      if (seen.has(task.id) || task.archived || task.status?.type === 'closed') continue;
      seen.add(task.id);
      const issue = toIssueData(task);
      if (
        term &&
        ![task.id, issue.identifier, issue.title, issue.description || ''].some((value) =>
          value.toLowerCase().includes(term)
        )
      )
        continue;
      issues.push(issue);
      if (issues.length >= limit) return ok(issues);
    }
    if (result.data.last_page || result.data.tasks.length < 100) break;
  }
  return ok(issues);
}

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const credentials = readClickUpCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  return queryAssignedTasks(credentials.data, clampIssueLimit(opts.limit, 50, 100));
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);
  const credentials = readClickUpCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  const id = taskReference(term)?.id;
  const explicitReference = Boolean(
    id && (CUSTOM_ID.test(id) || term.startsWith('https://') || term.startsWith('#'))
  );
  // Internal IDs are opaque and may be short or contain only letters. Try an
  // exact lookup first; a missing bare ID can still be an ordinary keyword.
  if (id) {
    const result = await fetchTask(credentials.data, term);
    if (result.success) return ok([result.data]);
    if (explicitReference) {
      return result.error.type === 'not_found_or_no_access' ? ok([]) : err(result.error);
    }
    if (result.error.type !== 'not_found_or_no_access' && result.error.type !== 'auth_failed') {
      return err(result.error);
    }
    // A bare word may be an inaccessible task ID or just a keyword. The assigned
    // tasks endpoint still checks authentication before returning text matches.
  }
  return queryAssignedTasks(
    credentials.data,
    clampIssueLimit(opts.limit, 20, 100),
    term.toLowerCase()
  );
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const credentials = readClickUpCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  return fetchTask(credentials.data, opts.identifier);
}

const plugin = defineIssuesPlugin({ integrationId: 'clickup' }, { issues: {} }, {});
export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
