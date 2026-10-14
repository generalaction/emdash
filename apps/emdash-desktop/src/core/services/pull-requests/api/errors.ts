import { pullRequestErrorSchema as pullRequestPluginErrorSchema } from '@emdash/plugins/pull-requests/schemas';
import { z } from 'zod';

/** The desktop service adds cache, registration, and dispatch failures to provider errors. */
export const pullRequestErrorSchema = z.discriminatedUnion('type', [
  pullRequestPluginErrorSchema,
  z.object({ type: z.literal('remote_not_ready'), status: z.string() }),
  z.object({ type: z.literal('unsupported_provider'), host: z.string(), reason: z.string() }),
  z.object({ type: z.literal('list_failed'), message: z.string() }),
  z.object({ type: z.literal('filter_options_failed'), message: z.string() }),
  z.object({ type: z.literal('task_pull_requests_failed'), message: z.string() }),
  z.object({ type: z.literal('repository_not_registered'), repositoryUrl: z.string() }),
]);

export type PullRequestError = z.infer<typeof pullRequestErrorSchema>;

export function pullRequestErrorMessage(error: PullRequestError): string {
  if ('message' in error) return error.message;
  if ('reason' in error) return error.reason;
  if ('hint' in error) return error.hint;
  return error.type;
}
