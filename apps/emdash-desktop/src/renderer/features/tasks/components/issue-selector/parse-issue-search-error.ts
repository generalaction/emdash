import type { LinkedIssue } from '@shared/core/linked-issue';

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
  error: string | null
): IssueSearchErrorDisplay | null {
  if (!error) return null;

  if (provider === 'notion') {
    if (
      /Could not find (database|page|data source)|cannot access the configured data source|not shared with|Missing permissions|missing access/i.test(
        error
      )
    ) {
      return {
        kind: 'access',
        title: 'Notion access required',
        description: notionAccessErrorDescription(error),
        actionLabel: 'Open integrations',
      };
    }

    if (/authentication failed|not connected|Failed to verify Notion/i.test(error)) {
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
