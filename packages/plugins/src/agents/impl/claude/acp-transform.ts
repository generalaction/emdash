import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/acp';

/**
 * Claude-specific enrichment of a baseline `NormalizedEvent`.
 *
 * The Claude ACP adapter stamps subagent child updates with
 * `_meta.claudeCode.parentToolUseId` to indicate that a tool call was produced
 * by a nested agent (Task/Agent tool). This function promotes that value to the
 * first-class `parentToolCallId` field so downstream consumers never need to
 * know about `claudeCode`.
 *
 * Returns the original update object unchanged when:
 * - The update is not a `tool_call` or `tool_update`.
 * - The vendor field is absent or not a string.
 */
export function enrichClaudeUpdate(update: NormalizedEvent, raw: SessionUpdate): NormalizedEvent {
  if (update.kind !== 'tool_call' && update.kind !== 'tool_update') return update;

  const parentToolUseId = (
    raw._meta as { claudeCode?: { parentToolUseId?: unknown } } | null | undefined
  )?.claudeCode?.parentToolUseId;

  if (typeof parentToolUseId !== 'string') return update;

  return { ...update, parentToolCallId: parentToolUseId };
}
