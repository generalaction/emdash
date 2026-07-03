import { err, ok } from '@emdash/shared';
import { getLinearClient } from '../../../integrations/impl/linear/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueDetail, IssueListResult } from '../../types';
import {
  formatLinearContext,
  hydrateIssueActivity,
  LINEAR_ISSUE_ACTIVITY_FIELDS,
  type LinearIssueWithActivity,
} from './issue-activity';

type LinearIssueSummaryNode = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string | null;
  state: { name: string; type: string; color: string } | null;
  team: { name: string; key: string } | null;
  project: { name: string } | null;
  assignee: { displayName: string; name: string } | null;
  updatedAt: string;
};

type LinearIssueContextNode = LinearIssueWithActivity<LinearIssueSummaryNode>;

const ISSUE_SUMMARY_FRAGMENT = `
  fragment IssueSummary on Issue {
    id
    identifier
    title
    description
    url
    branchName
    state { name type color }
    team { name key }
    project { name }
    assignee { displayName name }
    updatedAt
  }
`;

const ISSUES_QUERY = `
  ${ISSUE_SUMMARY_FRAGMENT}

  query ListIssues($limit: Int!) {
    issues(
      first: $limit,
      orderBy: updatedAt,
      filter: { state: { type: { nin: ["completed", "cancelled"] } } }
    ) {
      nodes {
        ...IssueSummary
      }
    }
  }
`;

const SEARCH_QUERY = `
  query SearchIssues($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
      }
    }
  }
`;

const ISSUE_CONTEXT_QUERY = `
  query IssueContext($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
        ${LINEAR_ISSUE_ACTIVITY_FIELDS}
      }
    }
  }
`;

function toIssue(raw: LinearIssueSummaryNode, context?: string): IssueData | IssueDetail {
  return {
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url ?? '',
    description: raw.description ?? undefined,
    context,
    branchName: raw.branchName ?? undefined,
    status: raw.state?.name ?? undefined,
    assignees: raw.assignee
      ? [raw.assignee.name ?? raw.assignee.displayName].filter(Boolean)
      : undefined,
    project: raw.project?.name ?? undefined,
    updatedAt: raw.updatedAt ?? undefined,
  };
}

async function listIssues(
  host: Parameters<typeof getLinearClient>[0],
  limit = 50
): Promise<IssueListResult> {
  const client = getLinearClient(host);
  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

  try {
    const { data } = await client.client.rawRequest<
      { issues: { nodes: LinearIssueSummaryNode[] } },
      { limit: number }
    >(ISSUES_QUERY, { limit: sanitizedLimit });

    return ok((data?.issues?.nodes ?? []).map((issue) => toIssue(issue)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch Linear issues.';
    return err(issueError('generic', message));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'linear' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: async (host, opts) => listIssues(host.credentials, opts.limit),

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const client = getLinearClient(host.credentials);
      const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);

      try {
        const { data } = await client.client.rawRequest<
          { searchIssues: { nodes: LinearIssueSummaryNode[] } },
          { term: string; limit: number }
        >(SEARCH_QUERY, { term, limit: sanitizedLimit });

        return ok((data?.searchIssues?.nodes ?? []).map((issue) => toIssue(issue)));
      } catch (error) {
        host.log.error('[Linear] searchIssues error', { error });
        const message = error instanceof Error ? error.message : 'Unable to search Linear issues.';
        return err(issueError('generic', message));
      }
    },

    async getIssue(host, opts) {
      const term = normalizeSearchTerm(opts.identifier);
      if (!term) return err(issueError('invalid_input', 'Linear issue identifier is required.'));

      const client = getLinearClient(host.credentials);
      try {
        const { data } = await client.client.rawRequest<
          { searchIssues: { nodes: LinearIssueContextNode[] } },
          { term: string; limit: number }
        >(ISSUE_CONTEXT_QUERY, { term, limit: 3 });
        const exactIssue = (data?.searchIssues?.nodes ?? []).find(
          (issue) => issue.identifier === term
        );

        if (!exactIssue) {
          return err(issueError('not_found_or_no_access', `Linear issue not found: ${term}`));
        }

        let hydratedIssue = exactIssue;
        try {
          hydratedIssue = await hydrateIssueActivity(client, exactIssue);
        } catch (error) {
          host.log.warn('[Linear] failed to hydrate issue activity', {
            issueId: exactIssue.id,
            identifier: exactIssue.identifier,
            error,
          });
        }

        return ok(toIssue(hydratedIssue, formatLinearContext(hydratedIssue)) as IssueDetail);
      } catch (error) {
        host.log.error('[Linear] getIssue error', { error });
        const message =
          error instanceof Error ? error.message : 'Unable to fetch Linear issue context.';
        return err(issueError('generic', message));
      }
    },
  },
});
