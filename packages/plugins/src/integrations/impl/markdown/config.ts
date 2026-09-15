import type { Result } from '@emdash/shared';
import z from 'zod';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';

/**
 * Configuration for the repository-tasks integration. It holds no secret: the
 * connection is a local switch plus the two facts the reader needs, which is
 * why the integration declares `repositoryPath` as its required input instead
 * of an account or a token.
 */

export const DEFAULT_TASK_PATTERN = 'docs/capabilities/*/*/tasks/WO-*.md';
export const DEFAULT_TRUNK_REF = 'origin/HEAD';

const configSchema = z.object({
  /** Repository-relative glob; `*` matches one path segment, `**` matches many. */
  taskPattern: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_TASK_PATTERN),
    z.string().min(1)
  ),
  /**
   * Ref the files are read from, so an out-of-date checkout never shows stale
   * tasks. Blank reads the working tree instead.
   */
  trunkRef: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : DEFAULT_TRUNK_REF),
    z.string()
  ),
});

export type MarkdownTasksConfig = z.infer<typeof configSchema>;

export function readMarkdownTasksConfig(
  raw: IntegrationCredentials
): Result<MarkdownTasksConfig, IntegrationError> {
  return parseCredentials(configSchema, raw);
}
