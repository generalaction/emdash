import { z } from 'zod';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { issueProviderIdSchema } from '@core/primitives/linked-issues/api/linked-issue';

const ISSUE_TARGET_RE = /\((issue:[^\s)]+)\)/g;

export type IssueMentionTarget = {
  token: string;
  provider: IssueProviderType;
  identifier: string;
  accountId?: string;
  issueUrl?: string;
};

const mentionSourceSchema = z
  .object({
    provider: issueProviderIdSchema,
    identifier: z.string().min(1),
    accountId: z.string().min(1).optional(),
    issueUrl: z.string().min(1).optional(),
  })
  .refine((source) => source.accountId !== undefined || source.issueUrl !== undefined);

export type LoadIssueContext = (target: IssueMentionTarget) => Promise<LinkedIssue | null>;

export function issueMentionToken(
  provider: IssueProviderType,
  identifier: string,
  source?: Pick<LinkedIssue, 'accountId' | 'url'>
): string {
  if (source?.accountId || source?.url) {
    const payload = {
      provider,
      identifier,
      accountId: source.accountId,
      issueUrl: source.url || undefined,
    };
    const encoded = encodeURIComponent(JSON.stringify(payload))
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    return `issue:v1:${encoded}`;
  }
  return `issue:${provider}:${identifier}`;
}

export function parseIssueMentionToken(token: string): IssueMentionTarget | null {
  if (token.startsWith('issue:v1:')) {
    try {
      const parsed = mentionSourceSchema.safeParse(
        JSON.parse(decodeURIComponent(token.slice('issue:v1:'.length)))
      );
      return parsed.success ? { token, ...parsed.data } : null;
    } catch {
      return null;
    }
  }
  if (!token.startsWith('issue:')) return null;
  const rest = token.slice('issue:'.length);
  const providerEnd = rest.indexOf(':');
  if (providerEnd <= 0) return null;
  const provider = rest.slice(0, providerEnd) as IssueProviderType;
  const identifier = rest.slice(providerEnd + 1);
  if (!identifier) return null;
  return { token, provider, identifier };
}

/** Legacy mentions may recover their source from the Task's linked snapshot, never its current account. */
export function resolveIssueMentionSource(
  target: IssueMentionTarget,
  linkedIssue?: LinkedIssue | null
): IssueMentionTarget | null {
  if (target.accountId || target.issueUrl) return target;
  if (
    linkedIssue?.provider !== target.provider ||
    linkedIssue.identifier !== target.identifier ||
    (!linkedIssue.accountId && !linkedIssue.url)
  )
    return null;
  return { ...target, accountId: linkedIssue.accountId, issueUrl: linkedIssue.url || undefined };
}

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

export function formatIssueProviderId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildIssueContextText(issue: LinkedIssue): string {
  const normalize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

  const parts: string[] = [
    `Provider: ${formatIssueProviderId(issue.provider)}`,
    `Identifier: ${issue.identifier}`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
  ];

  if (issue.description) parts.push(`Description: ${normalize(issue.description)}`);
  if (issue.status) parts.push(`Status: ${issue.status}`);
  if (issue.assignees?.length) parts.push(`Assignees: ${issue.assignees.join(', ')}`);
  if (issue.project) parts.push(`Project: ${issue.project}`);

  let text = parts.join('. ');

  if (issue.context) {
    text += `\nContext:\n${issue.context}`;
  }

  return text;
}

export function buildIssueMentionContextBlock(
  target: IssueMentionTarget,
  issue: LinkedIssue
): string {
  return [
    `<issue_context provider="${escapeXmlAttr(target.provider)}" identifier="${escapeXmlAttr(
      target.identifier
    )}">`,
    buildIssueContextText(issue),
    '</issue_context>',
  ].join('\n');
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
      return buildIssueMentionContextBlock(target, issue);
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
