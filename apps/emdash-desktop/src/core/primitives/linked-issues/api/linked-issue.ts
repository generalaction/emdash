import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

// ---------------------------------------------------------------------------
// v0 schema — unversioned legacy format stored in tasks.linked_issue
// ---------------------------------------------------------------------------

const v0Schema = z.object({
  provider: z.enum([
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
  ]),
  url: z.string(),
  title: z.string(),
  identifier: z.string(),
  /** Immutable provider-side id (Linear issue UUID), stable across workspace changes. */
  issueId: z.string().optional(),
  /** Source account the issue was fetched from; stamped server-side, never from the renderer. */
  sourceAccountId: z.string().optional(),
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

/**
 * True when `refreshed` cannot be confirmed to be the same workspace/issue as
 * `stored` — used to reject a cross-workspace fetch of the same identifier (WS9),
 * so re-pointing a project never pulls another workspace's issue into an agent.
 *
 * Fails closed: when the refresh carries durable identity but the stored issue
 * has none (a legacy link predating identity stamping), we cannot verify the
 * source, so we reject rather than accept another workspace's issue. Such a
 * legacy link stays stale until it is re-linked, which stamps it.
 */
export function isDifferentSource(
  stored: Pick<LinkedIssue, 'issueId' | 'sourceAccountId'>,
  refreshed: Pick<LinkedIssue, 'issueId' | 'sourceAccountId'>
): boolean {
  if (
    stored.sourceAccountId &&
    refreshed.sourceAccountId &&
    stored.sourceAccountId !== refreshed.sourceAccountId
  ) {
    return true;
  }
  if (stored.issueId && refreshed.issueId && stored.issueId !== refreshed.issueId) {
    return true;
  }
  const storedHasIdentity = Boolean(stored.sourceAccountId || stored.issueId);
  const refreshedHasIdentity = Boolean(refreshed.sourceAccountId || refreshed.issueId);
  return refreshedHasIdentity && !storedHasIdentity;
}
