import type { ProviderId } from './providers/registry';

export const DEFAULT_REVIEW_AGENT: ProviderId = 'claude';

export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

export interface ReviewSettings {
  enabled: boolean;
  agent: ProviderId;
  prompt: string;
}

export interface ReviewConversationMetadata {
  mode: 'review';
  initialPrompt: string;
  initialPromptSent?: boolean | null;
}

// AI Review types
export type ReviewDepth = 'quick' | 'focused' | 'comprehensive';

export const REVIEW_DEPTH_AGENTS: Record<ReviewDepth, number> = {
  quick: 1,
  focused: 3,
  comprehensive: 5,
};

export type ReviewType = 'file-changes';

export interface AIReviewConfig {
  depth: ReviewDepth;
  reviewType: ReviewType;
  providerId: ProviderId;
}

export interface AIReviewIssue {
  id: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  category: string;
  title: string;
  description: string;
  codeSnapshot?: string;
  filePath?: string;
  lineRange?: { start: number; end: number };
  fixPrompt?: string;
}

export interface AIReviewResult {
  reviewId: string;
  timestamp: string;
  depth: ReviewDepth;
  reviewType: ReviewType;
  issues: AIReviewIssue[];
  summary: string;
  durationMs: number;
  agentIds: string[]; // Conversation IDs of review agents
}

// Review prompt templates
export const REVIEW_PROMPTS = {
  fileChanges: {
    quick: `You are a code reviewer. Review the diff between the task's source branch and the current workspace for:
- Critical bugs and security issues
- Obvious correctness problems
- Major performance concerns

Provide your review in a structured format with specific issues found.`,
    focused: `You are a thorough code reviewer. Review the diff between the task's source branch and the current workspace for:
- Correctness, edge cases, and regressions
- Security vulnerabilities
- Performance issues
- Error handling problems
- Testing gaps
- Code maintainability

Provide your review in a structured format with specific issues found.`,
    comprehensive: `You are an expert code reviewer conducting a comprehensive review. Review diff between the task's source branch and the current workspace for:
- All correctness issues including edge cases
- Security (OWASP top 10, injection, auth issues)
- Performance bottlenecks and algorithmic improvements
- Error handling and fault tolerance
- Testing coverage and quality
- Maintainability and readability
- Best practices adherence
- Potential bugs and race conditions

Provide your review in a structured format with specific issues found, including severity and category.`,
  },
};

export function parseConversationMetadata(
  metadata?: string | null
): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getReviewConversationMetadata(
  metadata?: string | null
): ReviewConversationMetadata | null {
  const parsed = parseConversationMetadata(metadata);
  if (!parsed) return null;
  if (parsed.mode !== 'review') return null;

  const initialPrompt = typeof parsed.initialPrompt === 'string' ? parsed.initialPrompt.trim() : '';
  if (!initialPrompt) return null;

  return {
    mode: 'review',
    initialPrompt,
    initialPromptSent: parsed.initialPromptSent === true,
  };
}

export function buildReviewConversationMetadata(prompt: string): string {
  return JSON.stringify({
    mode: 'review',
    initialPrompt: prompt.trim(),
    initialPromptSent: false,
  } satisfies ReviewConversationMetadata);
}
