import { err, ok } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createLinearClient,
  readLinearCredentials,
} from '../../../integrations/impl/linear/client';
import { toLinearIntegrationError } from '../../../integrations/impl/linear/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { getLinearIssueDetails } from './context';
import { toIssueData, toIssueDetail } from './mapper';
import { queryLinearIssues, queryLinearIssueWithActivity, searchLinearIssues } from './queries';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readLinearCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createLinearClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);
  try {
    const issues = await queryLinearIssues(client, sanitizedLimit);
    return ok(issues.map(toIssueData));
  } catch (error) {
    host.log.warn('Linear listIssues failed', { error });
    return err(toLinearIntegrationError(error, 'Unable to fetch Linear issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);
  const parsedCredentials = readLinearCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createLinearClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);
  try {
    const issues = await searchLinearIssues(client, term, sanitizedLimit);
    return ok(issues.map(toIssueData));
  } catch (error) {
    host.log.warn('Linear searchIssues failed', { error });
    return err(toLinearIntegrationError(error, 'Unable to search Linear issues.'));
  }
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(opts.identifier);
  if (!term) return err({ type: 'invalid_input', message: 'Linear issue identifier is required.' });
  const parsedCredentials = readLinearCredentials(host.credentials);
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
    host.log.warn('Linear getIssue failed', { error });
    return err(toLinearIntegrationError(error, 'Unable to fetch Linear issue context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'linear' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
