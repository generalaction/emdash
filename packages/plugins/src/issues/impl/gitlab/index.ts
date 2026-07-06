import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createGitLabClient,
  readGitLabCredentials,
} from '../../../integrations/impl/gitlab/client';
import { resolveGitLabProject } from '../../../integrations/impl/gitlab/project-resolver';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readGitLabCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createGitLabClient(parsedCredentials.data);
  const project = await resolveGitLabProject(client, parsedCredentials.data, opts.repositoryUrl);
  if (!project.success) return err(project.error);

  try {
    const issues = await client.Issues.all({
      projectId: project.data.projectId,
      state: 'opened',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: clampIssueLimit(opts.limit, 50, 100),
      maxPages: 1,
    });

    return ok(issues.map((issue) => toIssueData(issue, project.data.projectName)));
  } catch (error) {
    host.log.warn('GitLab listIssues failed', { error });
    return err(toIntegrationError(error, 'GitLab', 'Unable to fetch GitLab issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readGitLabCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createGitLabClient(parsedCredentials.data);
  const project = await resolveGitLabProject(client, parsedCredentials.data, opts.repositoryUrl);
  if (!project.success) return err(project.error);

  try {
    const issues = await client.Issues.all({
      projectId: project.data.projectId,
      state: 'opened',
      search: term,
      in: 'title,description',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: clampIssueLimit(opts.limit, 20, 100),
      maxPages: 1,
    });

    return ok(issues.map((issue) => toIssueData(issue, project.data.projectName)));
  } catch (error) {
    host.log.warn('GitLab searchIssues failed', { error });
    return err(toIntegrationError(error, 'GitLab', 'Unable to search GitLab issues.'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'gitlab' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});
