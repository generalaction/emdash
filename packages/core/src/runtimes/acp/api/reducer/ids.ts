/**
 * Deterministic, stable id synthesis for transcript items.
 *
 * Ids are synthesized once in the parser and never re-derived downstream.
 * Content ids distinguish roles and provider/generated origins. Provider ids
 * are JSON-encoded opaque strings; generated ordinals never share their namespace.
 *
 * All functions are pure and total — no nullable returns. When a provider
 * messageId is absent the reducer's segmenter synthesizes a stable messageId
 * before item folding, ensuring every item always has a non-null internal id.
 */

/**
 * Stable turn id.
 * Format: `${conversationId}:turn:${turnIndex}`
 * `turnIndex` is 0-based and reflects the turn's position in the session.
 */
export function makeTurnId(conversationId: string, turnIndex: number): string {
  return `${conversationId}:turn:${turnIndex}`;
}

/**
 * Stable message item id.
 * Exact provider identity when supplied; otherwise a per-role segment ordinal.
 */
export function makeMessageId(
  turnId: string,
  messageId: string | null,
  role: string,
  ordinal = 0
): string {
  const identity =
    messageId === null ? `generated:${ordinal}` : `provider:${JSON.stringify(messageId)}`;
  return `${turnId}:message:${role}:${identity}`;
}

/**
 * Stable thinking item id.
 * A separate kind and explicit ordinal distinguish resumed reasoning segments
 * without interpreting provider ids as prefixes of previously generated ids.
 */
export function makeThinkingId(turnId: string, messageId: string | null, ordinal = 0): string {
  const identity = messageId === null ? 'generated' : `provider:${JSON.stringify(messageId)}`;
  return `${turnId}:thinking:${identity}:${ordinal}`;
}

/**
 * Stable tool item id.
 * Format: `${turnId}:tool:${toolCallId}`
 */
export function makeToolId(turnId: string, toolCallId: string): string {
  return `${turnId}:tool:${toolCallId}`;
}

/**
 * Stable tool group item id.
 * Format: `${firstChildId}:group`
 */
export function makeToolGroupId(firstChildId: string): string {
  return `${firstChildId}:group`;
}

/**
 * Stable parent id for nested tool calls, scoped to the same turn.
 * Returns undefined when parentToolCallId is null (no parent).
 */
export function makeParentId(turnId: string, parentToolCallId: string | null): string | undefined {
  return parentToolCallId != null ? makeToolId(turnId, parentToolCallId) : undefined;
}

/**
 * Stable diff item id.
 * Format: `${toolId}:${path}`
 * One diff item per changed file within a single tool call.
 */
export function makeDiffId(toolId: string, path: string): string {
  return `${toolId}:${path}`;
}

/**
 * Stable plan item id — one plan per turn.
 * Format: `${turnId}:plan`
 */
export function makePlanId(turnId: string): string {
  return `${turnId}:plan`;
}
