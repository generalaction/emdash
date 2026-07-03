import { err, ok } from '@emdash/shared';
import { readCredentialString } from '../../../integrations/helpers/credentials';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  fetchAsanaUser,
  getAsanaClient,
  toAsanaErrorMessage,
  type AsanaClient,
} from '../../../integrations/impl/asana/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueListResult } from '../../types';

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

function toIssue(task: AsanaTask): IssueData {
  const projectName =
    task.projects?.find((p) => !!p?.name)?.name ??
    task.memberships?.find((m) => !!m?.project?.name)?.project?.name;
  const sectionName = task.memberships?.find((m) => !!m?.section?.name)?.section?.name;

  return {
    identifier: task.gid,
    displayIdentifier: null,
    title: task.name ?? '',
    url: task.permalink_url ?? '',
    description: task.notes?.trim() || undefined,
    status: sectionName ?? (task.completed ? 'Completed' : undefined),
    assignees: task.assignee?.name ? [task.assignee.name] : undefined,
    project: projectName,
    updatedAt: task.modified_at,
  };
}

async function resolveClientAndWorkspace(
  credentials: IntegrationCredentials
): Promise<
  { success: true; client: AsanaClient; workspaceGid: string } | { success: false; error: string }
> {
  const client = getAsanaClient(credentials);
  let workspaceGid = readCredentialString(credentials, 'workspaceGid');

  if (!workspaceGid) {
    try {
      const user = await fetchAsanaUser(client);
      workspaceGid = user.workspaces?.[0]?.gid ?? null;
    } catch (error) {
      return {
        success: false,
        error: toAsanaErrorMessage(error, 'Failed to resolve Asana workspace.'),
      };
    }
  }

  if (!workspaceGid) {
    return { success: false, error: 'No Asana workspace available for this account.' };
  }

  return { success: true, client, workspaceGid };
}

async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const resolved = await resolveClientAndWorkspace(credentials);
  if (!resolved.success) return err(issueError('generic', resolved.error));

  const sanitizedLimit = clampIssueLimit(limit, 50, 100);

  try {
    const result = await resolved.client.get<AsanaTasksResponse>('/tasks', {
      assignee: 'me',
      workspace: resolved.workspaceGid,
      completed_since: 'now',
      limit: sanitizedLimit,
      opt_fields: TASK_OPT_FIELDS,
    });

    return ok((result.data ?? []).map(toIssue));
  } catch (error) {
    return err(issueError('generic', toAsanaErrorMessage(error, 'Failed to fetch Asana tasks.')));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'asana' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const resolved = await resolveClientAndWorkspace(host.credentials);
      if (!resolved.success) return err(issueError('generic', resolved.error));

      const sanitizedLimit = clampIssueLimit(opts.limit, 20, 100);

      try {
        const result = await resolved.client.get<AsanaTasksResponse>(
          `/workspaces/${resolved.workspaceGid}/tasks/search`,
          {
            text: term,
            resource_subtype: 'default_task',
            completed: false,
            limit: sanitizedLimit,
            opt_fields: TASK_OPT_FIELDS,
          }
        );

        return ok((result.data ?? []).map(toIssue));
      } catch (error) {
        host.log.error('[Asana] searchIssues error', { error });
        return err(
          issueError('generic', toAsanaErrorMessage(error, 'Failed to search Asana tasks.'))
        );
      }
    },
  },
});
