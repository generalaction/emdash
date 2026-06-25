import type { SessionUpdate } from '@agentclientprotocol/sdk';

/**
 * Normalizes Claude-specific ACP `_meta` into the neutral `_meta.emdash` namespace.
 *
 * The Claude ACP adapter stamps subagent child updates with
 * `_meta.claudeCode.parentToolUseId` to indicate that a tool call was produced
 * by a nested agent (Task/Agent tool). This function promotes that value to the
 * provider-agnostic `_meta.emdash.parentToolCallId` field so downstream
 * consumers never need to know about `claudeCode`.
 *
 * Returns the original update object unchanged when the vendor field is absent.
 */
export function normalizeClaudeUpdate(update: SessionUpdate): SessionUpdate {
  const meta = update._meta as
    | { claudeCode?: { parentToolUseId?: unknown }; emdash?: object }
    | null
    | undefined;

  const parentToolUseId = meta?.claudeCode?.parentToolUseId;
  if (typeof parentToolUseId !== 'string') return update;

  return {
    ...update,
    _meta: {
      ...update._meta,
      emdash: { ...(meta?.emdash ?? {}), parentToolCallId: parentToolUseId },
    },
  };
}
