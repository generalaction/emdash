/**
 * Deterministic, stable id synthesis for transcript items.
 *
 * Ids are synthesized once in the parser and never re-derived downstream.
 * The scheme preserves the existing renderer convention from acp-update-mapper.ts
 * so that a future migration can maintain render identity continuity.
 *
 * All functions are pure and total — no nullable returns. When a provider
 * messageId is absent the fold falls back to a role/kind suffix, ensuring
 * every item always has a non-null, stable id.
 */

// ── Turn ids ────────────────────────────────────────────────────────────────

/**
 * Stable turn id.
 * Format: `${conversationId}:turn:${turnIndex}`
 * `turnIndex` is 0-based and reflects the turn's position in the session.
 */
export function makeTurnId(conversationId: string, turnIndex: number): string {
  return `${conversationId}:turn:${turnIndex}`;
}

// ── Message ids ─────────────────────────────────────────────────────────────

/**
 * Stable message item id.
 * Format: `${turnId}:message:${messageId ?? role}`
 *
 * Uses the provider messageId when available for cross-chunk stability.
 * Falls back to role ('user'/'assistant') when absent — each role appears
 * at most once per turn, so the fallback is unambiguous.
 */
export function makeMessageId(turnId: string, messageId: string | null, role: string): string {
  return `${turnId}:message:${messageId ?? role}`;
}

// ── Thinking ids ────────────────────────────────────────────────────────────

/**
 * Stable thinking item id.
 * Format: `${turnId}:thinking:${messageId ?? 'main'}`
 *
 * A kind-tag prefix ('thinking:') disambiguates from message items when
 * Claude reuses the same messageId across both update kinds.
 */
export function makeThinkingId(turnId: string, messageId: string | null): string {
  return `${turnId}:thinking:${messageId ?? 'main'}`;
}

// ── Tool ids ────────────────────────────────────────────────────────────────

/**
 * Stable tool/file-op/execute item id.
 * Format: `${turnId}:${toolCallId}`
 */
export function makeToolId(turnId: string, toolCallId: string): string {
  return `${turnId}:${toolCallId}`;
}

/**
 * Stable parent id for nested tool calls, scoped to the same turn.
 * Returns undefined when parentToolCallId is null (no parent).
 */
export function makeParentId(turnId: string, parentToolCallId: string | null): string | undefined {
  return parentToolCallId != null ? `${turnId}:${parentToolCallId}` : undefined;
}

// ── Diff ids ────────────────────────────────────────────────────────────────

/**
 * Stable diff item id.
 * Format: `${toolId}:${path}`
 * One diff item per changed file within a single tool call.
 */
export function makeDiffId(toolId: string, path: string): string {
  return `${toolId}:${path}`;
}

// ── Plan id ─────────────────────────────────────────────────────────────────

/**
 * Stable plan item id — one plan per turn.
 * Format: `${turnId}:plan`
 */
export function makePlanId(turnId: string): string {
  return `${turnId}:plan`;
}
