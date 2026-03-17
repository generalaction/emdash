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
