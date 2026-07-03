/**
 * The internal normalized event type consumed by the AcpTranscriptParser reducer.
 *
 * NormalizedEvent is a delta/chunk — it represents a single ACP notification
 * after baseline decoding and optional provider enrichment. It is NEVER stored,
 * transported, or exported to consumers; it is the parser's private intermediate
 * type between the injected ProviderTransform and the item fold.
 *
 * Contrast with TranscriptItem (accumulated materialized state).
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { AttachmentRef, TranscriptPlanEntry } from './model';

// ── NormalizedEvent ─────────────────────────────────────────────────────────

export type NormalizedDiff = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type NormalizedToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type NormalizedEvent =
  | {
      kind: 'message';
      role: 'user' | 'assistant';
      /**
       * Provider-assigned message id, used as part of the stable item id.
       * Null when the provider doesn't supply one; the fold falls back to role.
       */
      messageId: string | null;
      text: string;
      /** Attachment references for user messages submitted with images. */
      attachments?: AttachmentRef[];
    }
  | {
      kind: 'thinking';
      messageId: string | null;
      text: string;
    }
  | {
      kind: 'tool_call';
      toolCallId: string;
      title: string;
      /** ACP ToolKind passthrough ('edit', 'execute', 'read', 'think', ...). */
      toolKind: string | null;
      status: NormalizedToolStatus | null;
      /**
       * Parent tool call id for nested subagent invocations.
       * Null in the baseline; providers promote vendor _meta via EnrichHook.
       */
      parentToolCallId: string | null;
      diffs: NormalizedDiff[];
    }
  | {
      kind: 'tool_update';
      toolCallId: string;
      title: string | null;
      toolKind: string | null;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
      diffs: NormalizedDiff[];
    }
  | {
      kind: 'plan';
      entries: TranscriptPlanEntry[];
    }
  | { kind: 'ignored' };

// ── Transform types ─────────────────────────────────────────────────────────

/**
 * A stateless function that decodes and normalizes a raw ACP SessionUpdate
 * into a NormalizedEvent. Injected into the parser; provided per-provider.
 *
 * Implementations should:
 *   1. Decode ACP-specific content blocks (text extraction, diff extraction).
 *   2. Enrich with vendor-specific metadata (e.g. parentToolCallId from _meta).
 *   3. Return `{ kind: 'ignored' }` for variants not yet handled.
 *
 * The function is stateless — all stateful folding (id synthesis, text
 * accumulation, turn boundaries) happens inside the parser reducer.
 */
export type ProviderTransform = (update: SessionUpdate) => NormalizedEvent;

/**
 * An optional enrichment hook that runs after baseline decoding.
 * Receives the decoded NormalizedEvent and the original raw SessionUpdate so
 * it can promote vendor _meta fields (e.g. parentToolCallId) into first-class
 * fields. Return the event unchanged if no enrichment is needed.
 */
export type EnrichHook = (event: NormalizedEvent, raw: SessionUpdate) => NormalizedEvent;

/**
 * Compose a baseline decode function with an optional per-provider enrich hook
 * into a single ProviderTransform.
 *
 * Usage:
 *   const transform = composeTransform(decodeSessionUpdate, enrichClaudeEvent);
 */
export function composeTransform(decode: ProviderTransform, enrich?: EnrichHook): ProviderTransform {
  if (!enrich) return decode;
  return (update: SessionUpdate): NormalizedEvent => enrich(decode(update), update);
}
