import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

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
    'trello',
  ]),
  url: z.string(),
  title: z.string(),
  identifier: z.string(),
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
