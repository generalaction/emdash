import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createPlaneClient, readPlaneCredentials } from '../../../integrations/impl/plane/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { formatPlaneContext } from './context';
import { toIssueData, toIssueDetail, toSearchIssueData } from './mapper';

const SEARCH_MIN_LENGTH = 2;
const MAX_PROJECTS_FOR_LIST = 10;
const WORK_ITEM_PAGE_LIMIT = 50;

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readPlaneCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlaneClient(parsedCredentials.data);
  const requestedLimit = clampIssueLimit(opts.limit, 50, 100);
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
    host.log.warn('Plane listIssues failed', { error });
    return err(toIntegrationError(error, 'Plane', 'Unable to fetch Plane work items.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (term.length < SEARCH_MIN_LENGTH) return ok([]);
  const parsedCredentials = readPlaneCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlaneClient(parsedCredentials.data);
  const requestedLimit = clampIssueLimit(opts.limit, 20, 100);
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
    host.log.warn('Plane searchIssues failed', { error });
    return err(toIntegrationError(error, 'Plane', 'Unable to search Plane work items.'));
  }
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(opts.identifier);
  if (!term) {
    return err({
      type: 'invalid_input',
      message: 'Plane work item identifier is required.',
    });
  }
  const parsedCredentials = readPlaneCredentials(host.credentials);
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
    host.log.warn('Plane getIssue failed', { error });
    return err(toIntegrationError(error, 'Plane', 'Unable to fetch Plane work item context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'plane' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
