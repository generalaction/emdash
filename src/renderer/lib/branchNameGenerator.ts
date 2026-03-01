import { BranchNameGenerator } from 'nbranch';
import type { LinearIssueSummary } from '../types/linear';
import type { GitHubIssueSummary } from '../types/github';
import type { JiraIssueSummary } from '../types/jira';

const MAX_NAME_LENGTH = 64;
const MIN_INPUT_LENGTH = 10;
const MAX_KEYWORDS = 3;

const generator = new BranchNameGenerator({ maxLength: 128, addRandomSuffix: false });

/**
 * Returns true if the input is unlikely to produce a meaningful task name.
 * Skips slash commands, very short inputs, and single short tokens.
 */
function isSkippableInput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < MIN_INPUT_LENGTH) return true;
  if (trimmed.startsWith('/')) return true;
  // Single word under 10 chars
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length < MIN_INPUT_LENGTH) return true;
  return false;
}

/**
 * Generate a slug-style task name from a natural language description.
 * Returns `null` if the input is too short or otherwise unsuitable.
 *
 * Example: "Fix the login page on mobile" → "fix-login-page-mobile"
 */
export function generateTaskName(description: string): string | null {
  if (isSkippableInput(description)) return null;

  try {
    const result = generator.generate(description);
    const keywords = result.keywords?.slice(0, MAX_KEYWORDS) ?? [];
    if (keywords.length === 0) return null;

    // Prefix with the commit type when available (fix, feat, etc.)
    const parts = result.type ? [result.type, ...keywords] : keywords;
    const slug = parts
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, MAX_NAME_LENGTH);

    return slug || null;
  } catch {
    return null;
  }
}

export interface TaskNameContext {
  initialPrompt?: string | null;
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
}

/**
 * Generate a task name from the best available context.
 * Priority: linked issue title+description > initial prompt.
 * Returns `null` if no usable context is available.
 */
export function generateTaskNameFromContext(context: TaskNameContext): string | null {
  // Try linked issues first — they have the richest context
  const issueText = getIssueText(context);
  if (issueText) {
    const name = generateTaskName(issueText);
    if (name) return name;
  }

  // Fall back to initial prompt
  if (context.initialPrompt) {
    return generateTaskName(context.initialPrompt);
  }

  return null;
}

function getIssueText(context: TaskNameContext): string | null {
  if (context.linearIssue) {
    const { title, description } = context.linearIssue as any;
    const parts = [title, description].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (context.githubIssue) {
    const { title, body } = context.githubIssue as any;
    const parts = [title, body].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (context.jiraIssue) {
    const { summary, description } = context.jiraIssue as any;
    const parts = [summary, description].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}
