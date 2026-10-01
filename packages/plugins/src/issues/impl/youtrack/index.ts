import { err, ok } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createYouTrackClient,
  readYouTrackCredentials,
} from '../../../integrations/impl/youtrack/client';
import { toYouTrackIntegrationError } from '../../../integrations/impl/youtrack/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { getYouTrackIssueDetails } from './context';
import { toIssueData, toIssueDetail } from './mapper';
import {
  queryYouTrackIssues,
  queryYouTrackIssueWithActivity,
  searchYouTrackIssues,
} from './queries';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const credentials = readYouTrackCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  const client = createYouTrackClient(credentials.data);
  const limit = clampIssueLimit(opts.limit, 50, 100);
  try {
    const issues = await queryYouTrackIssues(client, limit);
    return ok(issues.map((issue) => toIssueData(issue, credentials.data.instanceUrl)));
  } catch (error) {
    return err(toYouTrackIntegrationError(error));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);
  const credentials = readYouTrackCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  const client = createYouTrackClient(credentials.data);
  const limit = clampIssueLimit(opts.limit, 20, 100);
  try {
    const issues = await searchYouTrackIssues(client, term, limit);
    return ok(issues.map((issue) => toIssueData(issue, credentials.data.instanceUrl)));
  } catch (error) {
    return err(toYouTrackIntegrationError(error));
  }
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const identifier = normalizeSearchTerm(opts.identifier);
  if (!/^[^\s/\\?#]+-\d+$/u.test(identifier)) {
    return err({ type: 'invalid_input', message: 'A valid YouTrack ticket ID is required.' });
  }
  const credentials = readYouTrackCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  const client = createYouTrackClient(credentials.data);
  try {
    const issue = await queryYouTrackIssueWithActivity(client, identifier);
    const { context } = await getYouTrackIssueDetails(client, identifier, issue.commentsCount);
    return ok(toIssueDetail(issue, credentials.data.instanceUrl, context));
  } catch (error) {
    return err(toYouTrackIntegrationError(error));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'youtrack' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
