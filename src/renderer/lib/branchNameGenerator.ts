import { generateBranchName } from 'nbranch';
import { MAX_TASK_NAME_LENGTH } from './taskNames';
import type { LinearIssueSummary } from '../types/linear';
import type { GitHubIssueSummary } from '../types/github';
import type { JiraIssueSummary } from '../types/jira';

// Minimum character length for input to be considered a real task description.
const MIN_INPUT_LENGTH = 10;

// Patterns that indicate the input is a command, not a task description.
const SKIP_PATTERNS = [
  /^\/\S+/, // slash commands
  /^\S{1,10}$/, // single short token
];

// Checks whether terminal input looks like a real task description
export function isRealTaskInput(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < MIN_INPUT_LENGTH) return false;
  return !SKIP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Generates a normalized task name from a description using nbranch.
 * Returns empty string if input is not a meaningful task description.
 *
 * nbranch returns names like "fix-login-page-mobile-safari".
 * The result is already slugified (lowercase, hyphens).
 */
export function generateTaskName(description: string): string {
  if (!isRealTaskInput(description)) return '';

  try {
    const branchName = generateBranchName(description, {
      addRandomSuffix: false,
      separator: '-',
      maxLength: MAX_TASK_NAME_LENGTH,
      maxKeywords: 4,
    });
    return branchName.slice(0, MAX_TASK_NAME_LENGTH).replace(/-+$/, '');
  } catch {
    return '';
  }
}

interface TaskContext {
  initialPrompt?: string;
  linearIssue?: Pick<LinearIssueSummary, 'title' | 'description'> | null;
  githubIssue?: Pick<GitHubIssueSummary, 'title' | 'body'> | null;
  jiraIssue?: Pick<JiraIssueSummary, 'summary' | 'description'> | null;
}

function combineIssueText(title: string, description?: string | null): string {
  if (!description) return title;
  return `${title} ${description}`;
}

/**
 * Generates a task name from available context, with priority:
 * 1. Linked issue title + description (Linear > GitHub > Jira)
 * 2. Initial prompt text
 * Returns null if no usable context.
 */
export function generateTaskNameFromContext(context: TaskContext): string | null {
  let text: string | null = null;

  if (context.linearIssue) {
    text = combineIssueText(context.linearIssue.title, context.linearIssue.description);
  } else if (context.githubIssue) {
    text = combineIssueText(context.githubIssue.title, context.githubIssue.body);
  } else if (context.jiraIssue) {
    text = combineIssueText(context.jiraIssue.summary, context.jiraIssue.description);
  } else if (context.initialPrompt) {
    text = context.initialPrompt;
  }

  if (!text) return null;

  const name = generateTaskName(text);
  return name || null;
}
