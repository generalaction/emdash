import type { PullRequestError } from '@emdash/plugins/pull-requests/schemas';

export function pullRequestErrorMessage(error: PullRequestError): string {
  if ('message' in error) return error.message;
  if ('reason' in error) return error.reason;
  if ('hint' in error) return error.hint;
  return error.type;
}
