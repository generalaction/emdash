import type { JiraIssue } from '../../../integrations/impl/jira/types';
import type { IssueData } from '../../types';

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

export function toIssueData(issue: JiraIssue, siteUrl: string): IssueData {
  const base = siteUrl.replace(/\/$/, '');

  return {
    identifier: issue.key,
    title: String(issue.fields.summary || ''),
    url: `${base}/browse/${issue.key}`,
    description: issue.fields.description ? flattenAdf(issue.fields.description) : undefined,
    status: issue.fields.status?.name ?? undefined,
    statusCategory: toStatusCategory(issue.fields.status?.statusCategory?.key),
    assignees:
      issue.fields.assignee?.displayName != null
        ? [issue.fields.assignee.displayName ?? issue.fields.assignee.name ?? ''].filter(Boolean)
        : undefined,
    project: issue.fields.project?.name ?? undefined,
    updatedAt: issue.fields.updated ?? undefined,
  };
}

function flattenAdf(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';

  if (Array.isArray(node.content)) {
    const parts = node.content.map((item) => flattenAdf(item));
    if (['doc', 'bulletList', 'orderedList'].includes(node.type ?? '')) return parts.join('\n');
    if (['paragraph', 'heading', 'listItem'].includes(node.type ?? '')) return parts.join('');
    return parts.join('');
  }

  return '';
}

/** Jira keys are `new`, `indeterminate` and `done`; the category survives custom status names. */
function toStatusCategory(key: string | undefined): IssueData['statusCategory'] {
  if (key === 'new') return 'todo';
  if (key === 'indeterminate') return 'in_progress';
  if (key === 'done') return 'done';
  return undefined;
}
