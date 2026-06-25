/**
 * emdash-owned neutral `_meta` namespace for ACP SessionUpdates.
 *
 * Provider `transform()` implementations promote vendor-specific `_meta` fields
 * (e.g. `_meta.claudeCode.parentToolUseId`) into this namespace so downstream
 * consumers stay provider-agnostic and never need to know about vendor keys.
 *
 * The ACP spec types `_meta` as `{ [key: string]: unknown } | null` and
 * explicitly states implementations MUST NOT make assumptions about its values.
 * `readEmdashMeta` therefore treats all input as untrusted and never throws.
 */
export interface EmdashUpdateMeta {
  /**
   * Tool call id of the parent (e.g. a subagent Task call) when this update
   * was produced by a child/nested agent invocation.
   */
  parentToolCallId?: string;
}

/**
 * Defensively reads the `_meta.emdash` namespace from an arbitrary ACP
 * `_meta` value. Returns an empty object when the namespace is absent or
 * malformed — never throws.
 */
export function readEmdashMeta(meta: unknown): EmdashUpdateMeta {
  if (!meta || typeof meta !== 'object') return {};
  const emdash = (meta as { emdash?: unknown }).emdash;
  if (!emdash || typeof emdash !== 'object') return {};
  const { parentToolCallId } = emdash as { parentToolCallId?: unknown };
  return {
    parentToolCallId: typeof parentToolCallId === 'string' ? parentToolCallId : undefined,
  };
}
