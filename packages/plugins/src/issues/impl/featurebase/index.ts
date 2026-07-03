import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createFeaturebaseClient,
  readFeaturebaseCredentials,
} from '../../../integrations/impl/featurebase/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toIssueData } from './mapper';

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readFeaturebaseCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createFeaturebaseClient(parsedCredentials.data);

  try {
    const result = await client.feedback.posts.list({
      limit: clampIssueLimit(limit, 50, 100),
      sortBy: 'recent',
      sortOrder: 'desc',
    });
    return ok(result.data.map(toIssueData));
  } catch (error) {
    return err(toIntegrationError(error, 'Featurebase'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readFeaturebaseCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createFeaturebaseClient(parsedCredentials.data);

  try {
    const result = await client.feedback.posts.list({
      limit: clampIssueLimit(limit, 20, 100),
      sortBy: 'recent',
      sortOrder: 'desc',
      q: term,
    });
    return ok(result.data.map(toIssueData));
  } catch (error) {
    return err(toIntegrationError(error, 'Featurebase'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'featurebase' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
  },
});
