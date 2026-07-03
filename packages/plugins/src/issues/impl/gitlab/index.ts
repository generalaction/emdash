import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createGitLabClient,
  readGitLabCredentials,
} from '../../../integrations/impl/gitlab/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toIssueData } from './mapper';
import { resolveGitLabProject } from './repo-resolver';

export async function listIssues(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readGitLabCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createGitLabClient(parsedCredentials.data);
  const project = await resolveGitLabProject(client, parsedCredentials.data, repositoryUrl);
  if (!project.success) return err(project.error);

  try {
    const issues = await client.Issues.all({
      projectId: project.data.projectId,
      state: 'opened',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: clampIssueLimit(limit, 50, 100),
      maxPages: 1,
    });

    return ok(issues.map((issue) => toIssueData(issue, project.data.projectName)));
  } catch (error) {
    return err(toIntegrationError(error, 'GitLab'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readGitLabCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createGitLabClient(parsedCredentials.data);
  const project = await resolveGitLabProject(client, parsedCredentials.data, repositoryUrl);
  if (!project.success) return err(project.error);

  try {
    const issues = await client.Issues.all({
      projectId: project.data.projectId,
      state: 'opened',
      search: term,
      in: 'title,description',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: clampIssueLimit(limit, 20, 100),
      maxPages: 1,
    });

    return ok(issues.map((issue) => toIssueData(issue, project.data.projectName)));
  } catch (error) {
    return err(toIntegrationError(error, 'GitLab'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'gitlab' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.repositoryUrl, opts.limit),
    searchIssues: (host, opts) =>
      searchIssues(host.credentials, opts.repositoryUrl, opts.searchTerm, opts.limit),
  },
});
