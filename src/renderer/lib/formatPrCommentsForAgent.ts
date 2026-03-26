import type { PrComment } from './prCommentsStatus';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReviewState(state?: PrComment['reviewState']): string {
  switch (state) {
    case 'APPROVED':
      return ' state="approved"';
    case 'CHANGES_REQUESTED':
      return ' state="changes_requested"';
    default:
      return '';
  }
}

export function formatPrCommentsForAgent(comments: PrComment[]): string {
  if (!comments.length) return '';

  const entries = comments
    .map((c) => {
      const stateAttr = c.type === 'review' ? formatReviewState(c.reviewState) : '';
      return `  <comment author="${escapeXml(c.author.login)}"${stateAttr}>${escapeXml(c.body)}</comment>`;
    })
    .join('\n');

  return `\n<pr_comments>\n${entries}\n</pr_comments>`;
}
