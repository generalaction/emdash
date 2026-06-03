import { formatCommentsForAgent } from '@shared/lineComments';
import type { PromptLibraryFolder, PromptLibraryPrompt } from '@shared/prompt-library';
import type { Issue } from '@shared/tasks';
import type { DraftComment } from '../diff-view/stores/draft-comments-store';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContextActionKind = 'linked-issue' | 'draft-comments' | 'prompt';

export interface IssueContextAction {
  id: string;
  kind: 'linked-issue';
  provider: Issue['provider'];
  issue: Issue;
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
  folder?: PromptLibraryFolder;
}

export type ContextAction = IssueContextAction | DraftCommentsContextAction | PromptContextAction;

// ─── Text building ───────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<Issue['provider'], string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  gitlab: 'GitLab',
  plain: 'Plain',
  forgejo: 'Forgejo',
  featurebase: 'Featurebase',
  asana: 'Asana',
  monday: 'Monday.com',
};

export function buildIssueContextText(issue: Issue): string {
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

export function buildLinkedIssueContextAction(issue?: Issue): IssueContextAction | null {
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
  prompts: PromptLibraryPrompt[],
  folders: PromptLibraryFolder[] = []
): PromptContextAction[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const actions = prompts
    .filter((p) => p.prompt.trim().length > 0)
    .map((p) => ({
      id: `prompt:${p.id}`,
      kind: 'prompt' as const,
      prompt: p,
      folder: p.folderId ? foldersById.get(p.folderId) : undefined,
    }));

  return [
    ...folders.flatMap((folder) => actions.filter((action) => action.folder?.id === folder.id)),
    ...actions.filter((action) => !action.folder),
  ];
}

export function buildTaskContextActions(
  issue: Issue | undefined,
  comments: DraftComment[],
  prompts: PromptLibraryPrompt[],
  folders: PromptLibraryFolder[] = []
): ContextAction[] {
  return [
    buildLinkedIssueContextAction(issue),
    buildDraftCommentsContextAction(comments),
    ...buildPromptLibraryContextActions(prompts, folders),
  ].filter((a): a is ContextAction => a !== null);
}
