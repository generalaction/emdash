import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import { createAsanaClient, readAsanaCredentials } from '../../../integrations/impl/asana/client';
import type {
  AsanaResponse,
  AsanaSearchTasksOpts,
  AsanaTask,
  RawAsanaTask,
} from '../../../integrations/impl/asana/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toAsanaTask, toIssueData } from './mapper';
import { resolveAsanaWorkspace } from './workspace-resolver';

const TASK_OPT_FIELDS =
  'name,notes,permalink_url,completed,modified_at,assignee.name,projects.name,memberships.section.name,memberships.project.name';

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readAsanaCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createAsanaClient(parsedCredentials.data);

  const workspace = await resolveAsanaWorkspace(client);
  if (!workspace.success) return err(workspace.error);

  try {
    const response = (await client.tasks.getTasks({
      assignee: 'me',
      workspace: workspace.data.gid,
      completed_since: 'now',
      limit: clampIssueLimit(limit, 50, 100),
      opt_fields: TASK_OPT_FIELDS,
    })) as AsanaResponse<RawAsanaTask[]>;

    return ok(
      (response.data ?? [])
        .map(toAsanaTask)
        .filter((task): task is AsanaTask => task !== null)
        .map(toIssueData)
    );
  } catch (error) {
    return err(toIntegrationError(error, 'Asana'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readAsanaCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createAsanaClient(parsedCredentials.data);

  const workspace = await resolveAsanaWorkspace(client);
  if (!workspace.success) return err(workspace.error);

  try {
    const opts: AsanaSearchTasksOpts = {
      text: term,
      resource_subtype: 'default_task',
      completed: false,
      limit: clampIssueLimit(limit, 20, 100),
      opt_fields: TASK_OPT_FIELDS,
    };

    const response = (await client.tasks.searchTasksForWorkspace(
      workspace.data.gid,
      opts
    )) as AsanaResponse<RawAsanaTask[]>;

    return ok(
      (response.data ?? [])
        .map(toAsanaTask)
        .filter((task): task is AsanaTask => task !== null)
        .map(toIssueData)
    );
  } catch (error) {
    return err(toIntegrationError(error, 'Asana'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'asana' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
  },
});
