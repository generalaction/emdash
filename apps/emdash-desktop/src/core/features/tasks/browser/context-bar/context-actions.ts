import type { DraftComment } from '@core/features/source-control/api/browser/diff-view/stores/draft-comments-store';
import { buildIssueContextText } from '@core/primitives/issues/api';
import { formatCommentsForAgent } from '@core/primitives/line-comments/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { PromptLibraryPrompt } from '@core/primitives/prompt-library/api';

export { buildIssueContextText } from '@core/primitives/issues/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContextActionKind = 'linked-issue' | 'draft-comments' | 'prompt' | 'terminal-output';

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

export interface TerminalOutputContextAction {
  id: string;
  kind: 'terminal-output';
  terminalName: string;
  /** Read when the action is applied so the agent gets the terminal's current output. */
  readOutput: () => Promise<string>;
}

export type ContextAction =
  | IssueContextAction
  | DraftCommentsContextAction
  | PromptContextAction
  | TerminalOutputContextAction;

type StaticContextAction = Exclude<ContextAction, TerminalOutputContextAction>;

// ─── Text building ───────────────────────────────────────────────────────────

export function buildContextActionText(action: StaticContextAction): string {
  switch (action.kind) {
    case 'linked-issue':
      return buildIssueContextText(action.issue);
    case 'draft-comments':
      return formatCommentsForAgent(action.comments, { includeIntro: false });
    case 'prompt':
      return action.prompt.prompt;
  }
}

export async function readContextActionText(action: ContextAction): Promise<string> {
  if (action.kind !== 'terminal-output') return buildContextActionText(action);
  return formatTerminalOutputForAgent(action.terminalName, await action.readOutput());
}

export function formatTerminalOutputForAgent(terminalName: string, output: string): string {
  if (!output.trim()) return '';
  const longestBacktickRun = Math.max(0, ...Array.from(output.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return `Output from terminal "${terminalName}":\n${fence}\n${output}\n${fence}`;
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

export function buildTerminalOutputContextActions(
  terminals: { id: string; name: string; readOutput: () => Promise<string> }[]
): TerminalOutputContextAction[] {
  return terminals.map((terminal) => ({
    id: `terminal-output:${terminal.id}`,
    kind: 'terminal-output' as const,
    terminalName: terminal.name,
    readOutput: terminal.readOutput,
  }));
}

export function buildTaskContextActions(
  issue: LinkedIssue | undefined,
  comments: DraftComment[],
  prompts: PromptLibraryPrompt[],
  terminals: TerminalOutputContextAction[] = []
): ContextAction[] {
  return [
    buildLinkedIssueContextAction(issue),
    buildDraftCommentsContextAction(comments),
    ...terminals,
    ...buildPromptLibraryContextActions(prompts),
  ].filter((a): a is ContextAction => a !== null);
}
