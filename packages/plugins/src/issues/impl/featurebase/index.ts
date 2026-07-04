import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createFeaturebaseClient,
  readFeaturebaseCredentials,
} from '../../../integrations/impl/featurebase/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readFeaturebaseCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createFeaturebaseClient(parsedCredentials.data);

  try {
    const result = await client.feedback.posts.list({
      limit: clampIssueLimit(opts.limit, 50, 100),
      sortBy: 'recent',
      sortOrder: 'desc',
    });
    return ok(result.data.map(toIssueData));
  } catch (error) {
    host.log.warn('Featurebase listIssues failed', { error });
    return err(toIntegrationError(error, 'Featurebase', 'Unable to fetch Featurebase posts.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readFeaturebaseCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createFeaturebaseClient(parsedCredentials.data);

  try {
    const result = await client.feedback.posts.list({
      limit: clampIssueLimit(opts.limit, 20, 100),
      sortBy: 'recent',
      sortOrder: 'desc',
      q: term,
    });
    return ok(result.data.map(toIssueData));
  } catch (error) {
    host.log.warn('Featurebase searchIssues failed', { error });
    return err(toIntegrationError(error, 'Featurebase', 'Unable to search Featurebase posts.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'featurebase' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});
