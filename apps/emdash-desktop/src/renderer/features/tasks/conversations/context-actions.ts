import type { LinkedIssue } from '@shared/core/linked-issue';
import type { IssueAttachment } from '@shared/issue-providers';
import { formatCommentsForAgent } from '@shared/lineComments';
import type { PromptLibraryPrompt } from '@shared/prompt-library';
import type { DraftComment } from '../diff-view/stores/draft-comments-store';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContextActionKind = 'linked-issue' | 'draft-comments' | 'prompt';

export interface IssueContextAction {
  id: string;
  kind: 'linked-issue';
  provider: LinkedIssue['provider'];
  issue: LinkedIssue;
}

export interface DraftCommentsContextAction {
  id: string;
  kind: 'draft-comments';
  comments: DraftComment[];
  commentCount: number;
  fileCount: number;
}

export interface PromptContextAction {
  id: string;
  kind: 'prompt';
  prompt: PromptLibraryPrompt;
}

export type ContextAction = IssueContextAction | DraftCommentsContextAction | PromptContextAction;

// ─── Text building ───────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<LinkedIssue['provider'], string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  gitlab: 'GitLab',
  plane: 'Plane',
  plain: 'Plain',
  forgejo: 'Forgejo',
  featurebase: 'Featurebase',
  asana: 'Asana',
  monday: 'Monday.com',
  trello: 'Trello',
};

export function buildIssueContextText(issue: LinkedIssue, attachments?: IssueAttachment[]): string {
  const normalize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

  const parts: string[] = [
    `Provider: ${PROVIDER_LABELS[issue.provider]}`,
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

  if (attachments?.length) {
    text += `\nAttachments (local copies of images from the issue — open these files to view them):\n${attachments
      .map((attachment) => `- ${attachment.localPath} (source: ${attachment.url})`)
      .join('\n')}`;
  }

  return text;
}

export function buildContextActionText(action: ContextAction): string {
  switch (action.kind) {
    case 'linked-issue':
      return buildIssueContextText(action.issue);
    case 'draft-comments':
      return formatCommentsForAgent(action.comments, { includeIntro: false });
    case 'prompt':
      return action.prompt.prompt;
  }
}

// ─── Builders ────────────────────────────────────────────────────────────────

export function buildLinkedIssueContextAction(issue?: LinkedIssue): IssueContextAction | null {
  if (!issue) return null;
  return {
    id: `linked-issue:${issue.provider}:${issue.identifier}`,
    kind: 'linked-issue',
    provider: issue.provider,
    issue,
  };
}

export function buildDraftCommentsContextAction(
  comments: DraftComment[]
): DraftCommentsContextAction | null {
  if (comments.length === 0) return null;
  const fileCount = new Set(comments.map((c) => c.filePath)).size;
  return {
    id: 'draft-comments',
    kind: 'draft-comments',
    comments,
    commentCount: comments.length,
    fileCount,
  };
}

export function buildPromptLibraryContextActions(
  prompts: PromptLibraryPrompt[]
): PromptContextAction[] {
  return prompts
    .filter((p) => p.prompt.trim().length > 0)
    .map((p) => ({
      id: `prompt:${p.id}`,
      kind: 'prompt' as const,
      prompt: p,
    }));
}

export function buildTaskContextActions(
  issue: LinkedIssue | undefined,
  comments: DraftComment[],
  prompts: PromptLibraryPrompt[]
): ContextAction[] {
  return [
    buildLinkedIssueContextAction(issue),
    buildDraftCommentsContextAction(comments),
    ...buildPromptLibraryContextActions(prompts),
  ].filter((a): a is ContextAction => a !== null);
}
