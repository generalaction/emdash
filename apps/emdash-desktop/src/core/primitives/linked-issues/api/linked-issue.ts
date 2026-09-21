import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

// ---------------------------------------------------------------------------
// v0 schema — unversioned legacy format stored in tasks.linked_issue
// ---------------------------------------------------------------------------

export const issueProviderIdSchema = z.enum([
  'github',
  'linear',
  'jira',
  'gitlab',
  'plane',
  'plain',
  'forgejo',
  'featurebase',
  'asana',
  'monday',
  'notion',
  'trello',
]);

const v0Schema = z.object({
  provider: issueProviderIdSchema,
  url: z.string(),
  title: z.string(),
  identifier: z.string(),
  accountId: z.string().min(1).optional(),
  displayIdentifier: z.string().nullable().optional(),
  description: z.string().optional(),
  context: z.string().optional(),
  branchName: z.string().optional(),
  status: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  project: z.string().optional(),
  updatedAt: z.string().optional(),
  fetchedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Versioned schema
// ---------------------------------------------------------------------------

/**
 * Versioned schema for a linked issue stored in `tasks.linked_issue`.
 *
 * A task's linked issue captures the issue metadata at the time of linking.
 * The stored shape is a flat object with no version field (unversioned legacy).
 */
export const linkedIssue = defineVersionedSchema().unversioned(v0Schema).build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The Zod schema for the latest linked issue shape. */
export const linkedIssueSchema = linkedIssue.schema;

/** The TypeScript type for a linked issue. */
export type LinkedIssue = typeof linkedIssue.Type;

/**
 * A source URL anchors legacy links to a resource, including its host and workspace/repository.
 * Only documented presentation segments are omitted; account access alone is not identity.
 */
export function linkedIssueResourcesMatch(
  provider: LinkedIssue['provider'],
  expected: string,
  actual: string
): boolean {
  const source = issueResourceKey(provider, expected);
  return source !== null && source === issueResourceKey(provider, actual);
}

function issueResourceKey(provider: LinkedIssue['provider'], value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    // Trello shortLink is globally unique; the following name slug changes on rename.
    if (provider === 'trello') {
      const card = /^\/c\/([a-zA-Z0-9]+)(?:\/[^/]*)?$/.exec(url.pathname);
      return card ? `${url.origin}/c/${card[1]}` : null;
    }
    // Linear's shorthand is only unique inside a workspace. Keep that workspace segment.
    if (provider === 'linear') {
      const issue = /^(\/[^/]+\/issue\/[^/]+)(?:\/[^/]*)?$/.exec(url.pathname);
      return issue ? `${url.origin}${issue[1]}` : null;
    }
    // Notion page URLs append the immutable page UUID to the mutable title slug.
    if (provider === 'notion') {
      const page =
        /(?:^|[-/])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
          url.pathname
        );
      return page ? `${url.origin}/${page[1].replaceAll('-', '').toLowerCase()}` : null;
    }
    // Other adapters return resource URLs without mutable title segments. Retain the
    // full path (e.g. GitLab repository and iid), plus any identifying query string.
    return url.href;
  } catch {
    return null;
  }
}

export function linkedIssueDisplayIdentifier(
  issue: Pick<LinkedIssue, 'identifier' | 'displayIdentifier'>
): string | null {
  return issue.displayIdentifier === null ? null : (issue.displayIdentifier ?? issue.identifier);
}

export function linkedIssueMentionName(
  issue: Pick<LinkedIssue, 'identifier' | 'displayIdentifier' | 'title'>
): string {
  return linkedIssueDisplayIdentifier(issue) ?? (issue.title || 'Linked issue');
}
