import { err, ok } from '@emdash/shared';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createLinearClient,
  readLinearCredentials,
} from '../../../integrations/impl/linear/client';
import { toLinearIntegrationError } from '../../../integrations/impl/linear/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueGetResult, IssueListResult } from '../../types';
import { getLinearIssueDetails } from './context';
import { toIssueData, toIssueDetail } from './mapper';
import { queryLinearIssues, queryLinearIssueWithActivity, searchLinearIssues } from './queries';

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readLinearCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createLinearClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(limit, 50, 200);
  try {
    const issues = await queryLinearIssues(client, sanitizedLimit);
    return ok(issues.map(toIssueData));
  } catch (error) {
    return err(toLinearIntegrationError(error, 'Unable to fetch Linear issues.'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);
  const parsedCredentials = readLinearCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createLinearClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(limit, 20, 200);
  try {
    const issues = await searchLinearIssues(client, term, sanitizedLimit);
    return ok(issues.map(toIssueData));
  } catch (error) {
    return err(toLinearIntegrationError(error, 'Unable to search Linear issues.'));
  }
}

export async function getIssue(
  credentials: IntegrationCredentials,
  identifier: string
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(identifier);
  if (!term) return err({ type: 'invalid_input', message: 'Linear issue identifier is required.' });
  const parsedCredentials = readLinearCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createLinearClient(parsedCredentials.data);
  try {
    const issue = await queryLinearIssueWithActivity(client, term);
    if (!issue) {
      return err({ type: 'not_found_or_no_access', message: `Linear issue not found: ${term}` });
    }
    const { context } = await getLinearIssueDetails(client, issue);
    return ok(toIssueDetail(issue, context));
  } catch (error) {
    return err(toLinearIntegrationError(error, 'Unable to fetch Linear issue context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'linear' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
    getIssue: (host, opts) => getIssue(host.credentials, opts.identifier),
  },
});
