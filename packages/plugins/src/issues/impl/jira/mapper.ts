import type { JiraIssue } from '../../../integrations/impl/jira/types';
import type { IssueData } from '../../types';

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: { text?: string; url?: string; alt?: string };
  marks?: { type?: string; attrs?: { href?: string } }[];
};

export function toIssueData(issue: JiraIssue, siteUrl: string): IssueData {
  const base = siteUrl.replace(/\/$/, '');

  return {
    identifier: issue.key,
    title: String(issue.fields.summary || ''),
    url: `${base}/browse/${issue.key}`,
    description: issue.fields.description ? flattenAdf(issue.fields.description) : undefined,
    status: issue.fields.status?.name ?? undefined,
    assignees:
      issue.fields.assignee?.displayName != null
        ? [issue.fields.assignee.displayName ?? issue.fields.assignee.name ?? ''].filter(Boolean)
        : undefined,
    project: issue.fields.project?.name ?? undefined,
    updatedAt: issue.fields.updated ?? undefined,
  };
}

export function flattenAdf(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') {
    const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    return href ? `[${node.text ?? ''}](${href})` : (node.text ?? '');
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text ?? '';
  if (node.type === 'inlineCard' || node.type === 'blockCard') return node.attrs?.url ?? '';
  if (node.type === 'media') return node.attrs?.alt ?? '';

  if (Array.isArray(node.content)) {
    const parts = node.content.map((item) => flattenAdf(item));
    if (
      [
        'doc',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'table',
        'tableCell',
        'tableHeader',
      ].includes(node.type ?? '')
    )
      return parts.join('\n');
    if (node.type === 'tableRow') return parts.join(' | ');
    return parts.join('');
  }

  return '';
}
