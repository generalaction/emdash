import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import type { AsanaClient } from './asana-client';
import {
  asanaConnectionService,
  NOT_CONFIGURED_ERROR,
  toAsanaErrorMessage,
} from './asana-connection-service';

type AsanaTask = {
  gid: string;
  name?: string;
  notes?: string;
  permalink_url?: string;
  completed?: boolean;
  modified_at?: string;
  assignee?: { name?: string } | null;
  projects?: Array<{ name?: string }>;
  memberships?: Array<{
    section?: { name?: string } | null;
    project?: { name?: string } | null;
  }>;
};

type AsanaTasksResponse = {
  data?: AsanaTask[];
};

const TASK_OPT_FIELDS =
  'name,notes,permalink_url,completed,modified_at,assignee.name,projects.name,memberships.section.name,memberships.project.name';

function toIssue(task: AsanaTask): Issue {
  const projectName =
    task.projects?.find((p) => !!p?.name)?.name ??
    task.memberships?.find((m) => !!m?.project?.name)?.project?.name;
  const sectionName = task.memberships?.find((m) => !!m?.section?.name)?.section?.name;

  return {
    provider: 'asana',
    identifier: task.gid,
    title: task.name ?? '',
    url: task.permalink_url ?? '',
    description: task.notes?.trim() || undefined,
    status: sectionName ?? (task.completed ? 'Completed' : undefined),
    assignees: task.assignee?.name ? [task.assignee.name] : undefined,
    project: projectName,
    updatedAt: task.modified_at,
    fetchedAt: new Date().toISOString(),
  };
}

async function getClientAndWorkspace(): Promise<
  { success: true; client: AsanaClient; workspaceGid: string } | { success: false; error: string }
> {
  const client = await asanaConnectionService.getClient();
  if (!client) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  let workspaceGid: string | null;
  try {
    workspaceGid = await asanaConnectionService.getPrimaryWorkspaceGid();
  } catch (error) {
    return {
      success: false,
      error: toAsanaErrorMessage(error, 'Failed to resolve Asana workspace.'),
    };
  }

  if (!workspaceGid) {
    return {
      success: false,
      error: 'No Asana workspace available for this account.',
    };
  }

  return { success: true, client, workspaceGid };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const resolved = await getClientAndWorkspace();
  if (!resolved.success) {
    return { success: false, error: resolved.error };
  }

  const sanitizedLimit = clampIssueLimit(limit, 50, 100);

  try {
    const result = await resolved.client.get<AsanaTasksResponse>('/tasks', {
      assignee: 'me',
      workspace: resolved.workspaceGid,
      completed_since: 'now',
      limit: sanitizedLimit,
      opt_fields: TASK_OPT_FIELDS,
    });

    return {
      success: true,
      issues: (result.data ?? []).map(toIssue),
    };
  } catch (error) {
    return {
      success: false,
      error: toAsanaErrorMessage(error, 'Failed to fetch Asana tasks.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const resolved = await getClientAndWorkspace();
  if (!resolved.success) {
    return { success: false, error: resolved.error };
  }

  const sanitizedLimit = clampIssueLimit(limit, 20, 100);

  try {
    const result = await resolved.client.get<AsanaTasksResponse>(
      `/workspaces/${resolved.workspaceGid}/tasks/search`,
      {
        text: term,
        resource_subtype: 'default_task',
        'completed.not': true,
        limit: sanitizedLimit,
        opt_fields: TASK_OPT_FIELDS,
      }
    );

    return {
      success: true,
      issues: (result.data ?? []).map(toIssue),
    };
  } catch (error) {
    log.error('[Asana] searchIssues error:', error);
    return {
      success: false,
      error: toAsanaErrorMessage(error, 'Failed to search Asana tasks.'),
    };
  }
}

export const asanaIssueProvider: IssueProvider = {
  type: 'asana',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.asana,

  checkConnection: () => asanaConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
