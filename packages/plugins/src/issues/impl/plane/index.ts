import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import { createPlaneClient, readPlaneCredentials } from '../../../integrations/impl/plane/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueGetResult, IssueListResult } from '../../types';
import { formatPlaneContext } from './context';
import { toIssueData, toIssueDetail, toSearchIssueData } from './mapper';

const SEARCH_MIN_LENGTH = 2;
const MAX_PROJECTS_FOR_LIST = 10;
const WORK_ITEM_PAGE_LIMIT = 50;

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readPlaneCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlaneClient(parsedCredentials.data);
  const requestedLimit = clampIssueLimit(limit, 50, 100);
  try {
    const projects = await client.projects.list(parsedCredentials.data.workspaceSlug, {
      limit: MAX_PROJECTS_FOR_LIST,
    });
    const issues = [];
    for (const project of projects.results) {
      if (issues.length >= requestedLimit) break;
      const remaining = requestedLimit - issues.length;
      const items = await client.workItems.list(parsedCredentials.data.workspaceSlug, project.id, {
        limit: Math.min(remaining, WORK_ITEM_PAGE_LIMIT),
      });
      issues.push(
        ...items.results.map((item) => toIssueData(item, parsedCredentials.data, project))
      );
    }
    return ok(issues.slice(0, requestedLimit));
  } catch (error) {
    return err(toIntegrationError(error, 'Plane'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (term.length < SEARCH_MIN_LENGTH) return ok([]);
  const parsedCredentials = readPlaneCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlaneClient(parsedCredentials.data);
  const requestedLimit = clampIssueLimit(limit, 20, 100);
  try {
    const result = await client.workItems.search(
      parsedCredentials.data.workspaceSlug,
      term,
      undefined,
      {
        limit: requestedLimit,
      }
    );
    return ok(
      result.issues
        .map((item) => toSearchIssueData(item, parsedCredentials.data))
        .slice(0, requestedLimit)
    );
  } catch (error) {
    return err(toIntegrationError(error, 'Plane'));
  }
}

export async function getIssue(
  credentials: IntegrationCredentials,
  identifier: string
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(identifier);
  if (!term) {
    return err({
      type: 'invalid_input',
      message: 'Plane work item identifier is required.',
    });
  }
  const parsedCredentials = readPlaneCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlaneClient(parsedCredentials.data);
  try {
    const item = await client.workItems.retrieveByIdentifier(
      parsedCredentials.data.workspaceSlug,
      term,
      ['assignees', 'state', 'project']
    );
    return ok(toIssueDetail(item, parsedCredentials.data, formatPlaneContext(item)));
  } catch (error) {
    return err(toIntegrationError(error, 'Plane'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'plane' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
    getIssue: (host, opts) => getIssue(host.credentials, opts.identifier),
  },
});
