import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  parseIssueMentionToken,
  type IssueMentionTarget,
} from '../../../lib/chat/chat-mention-provider';
import { buildIssueContextText } from '../../tasks/context-bar/context-actions';

const ISSUE_TARGET_RE = /\((issue:[^\s)]+)\)/g;

export type LoadIssueContext = (target: IssueMentionTarget) => Promise<LinkedIssue | null>;

export function extractIssueMentionTargets(text: string): IssueMentionTarget[] {
  const seen = new Set<string>();
  const targets: IssueMentionTarget[] = [];
  let match: RegExpExecArray | null;

  while ((match = ISSUE_TARGET_RE.exec(text)) !== null) {
    const token = match[1];
    const target = token ? parseIssueMentionToken(token) : null;
    if (!target || seen.has(target.token)) continue;
    seen.add(target.token);
    targets.push(target);
  }

  return targets;
}

export async function buildIssueMentionHiddenContext(
  text: string,
  loadIssue: LoadIssueContext
): Promise<string | undefined> {
  const targets = extractIssueMentionTargets(text);
  if (targets.length === 0) return undefined;

  const blocks = await Promise.all(
    targets.map(async (target) => {
      const issue = await loadIssue(target).catch(() => null);
      if (!issue) return null;
      return [
        `<issue_context provider="${escapeXmlAttr(target.provider)}" identifier="${escapeXmlAttr(
          target.identifier
        )}">`,
        buildIssueContextText(issue),
        '</issue_context>',
      ].join('\n');
    })
  );

  const hiddenContext = blocks.filter((block): block is string => block !== null).join('\n\n');
  return hiddenContext.length > 0 ? hiddenContext : undefined;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
