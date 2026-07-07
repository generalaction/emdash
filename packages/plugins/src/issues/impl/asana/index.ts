import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createAsanaClient, readAsanaCredentials } from '../../../integrations/impl/asana/client';
import type {
  AsanaResponse,
  AsanaSearchTasksOpts,
  AsanaTask,
  RawAsanaTask,
} from '../../../integrations/impl/asana/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toAsanaTask, toIssueData } from './mapper';
import { resolveAsanaWorkspace } from './workspace-resolver';

const TASK_OPT_FIELDS =
  'name,notes,permalink_url,completed,modified_at,assignee.name,projects.name,memberships.section.name,memberships.project.name';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readAsanaCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createAsanaClient(parsedCredentials.data);

  const workspace = await resolveAsanaWorkspace(client);
  if (!workspace.success) return err(workspace.error);

  try {
    const response = (await client.tasks.getTasks({
      assignee: 'me',
      workspace: workspace.data.gid,
      completed_since: 'now',
      limit: clampIssueLimit(opts.limit, 50, 100),
      opt_fields: TASK_OPT_FIELDS,
    })) as AsanaResponse<RawAsanaTask[]>;

    return ok(
      (response.data ?? [])
        .map(toAsanaTask)
        .filter((task): task is AsanaTask => task !== null)
        .map(toIssueData)
    );
  } catch (error) {
    host.log.warn('Asana listIssues failed', { error });
    return err(toIntegrationError(error, 'Asana', 'Unable to fetch Asana tasks.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readAsanaCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createAsanaClient(parsedCredentials.data);

  const workspace = await resolveAsanaWorkspace(client);
  if (!workspace.success) return err(workspace.error);

  try {
    const searchOpts: AsanaSearchTasksOpts = {
      text: term,
      resource_subtype: 'default_task',
      completed: false,
      limit: clampIssueLimit(opts.limit, 20, 100),
      opt_fields: TASK_OPT_FIELDS,
    };

    const response = (await client.tasks.searchTasksForWorkspace(
      workspace.data.gid,
      searchOpts
    )) as AsanaResponse<RawAsanaTask[]>;

    return ok(
      (response.data ?? [])
        .map(toAsanaTask)
        .filter((task): task is AsanaTask => task !== null)
        .map(toIssueData)
    );
  } catch (error) {
    host.log.warn('Asana searchIssues failed', { error });
    return err(toIntegrationError(error, 'Asana', 'Unable to search Asana tasks.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'asana' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});
