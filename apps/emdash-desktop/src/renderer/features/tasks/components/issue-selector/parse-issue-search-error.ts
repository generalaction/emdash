import type { LinkedIssue } from '@shared/core/linked-issue';
import type { IssueListError } from '@shared/issue-providers';

export type IssueSearchErrorDisplay = {
  kind: 'access' | 'auth' | 'generic';
  title: string;
  description: string;
  actionLabel?: string;
};

function notionAccessErrorDescription(error: string): string {
  const integrationMatch = error.match(/integration "([^"]+)"/i);
  const integrationName = integrationMatch?.[1] ?? 'your Notion integration';

  if (/scope URLs|Emdash settings/i.test(error)) {
    return error;
  }

  return `Share the page or database with ${integrationName}, or update the scope URLs in Emdash settings.`;
}

export function parseIssueSearchError(
  provider: LinkedIssue['provider'] | null,
  error: string | null,
  errorType?: IssueListError['type'] | null
): IssueSearchErrorDisplay | null {
  if (!error) return null;

  if (provider === 'notion') {
    if (errorType === 'not_found_or_no_access' || errorType === 'forbidden') {
      return {
        kind: 'access',
        title: 'Notion access required',
        description: notionAccessErrorDescription(error),
        actionLabel: 'Open integrations',
      };
    }

    if (errorType === 'auth_required' || errorType === 'token_missing') {
      return {
        kind: 'auth',
        title: 'Notion connection issue',
        description: error,
        actionLabel: 'Open integrations',
      };
    }
  }

  if (provider === 'github' && /does not have access|not found|Connect GitHub/i.test(error)) {
    return {
      kind: 'access',
      title: 'GitHub access required',
      description: error,
      actionLabel: 'Open integrations',
    };
  }

  return {
    kind: 'generic',
    title: 'Could not load issues',
    description: error,
  };
}
