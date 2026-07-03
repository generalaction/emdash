/**
 * Baseline ACP SessionUpdate decoder.
 *
 * Converts raw ACP SDK SessionUpdate notifications into the parser's internal
 * NormalizedEvent vocabulary. This is the parser-owned equivalent of the
 * legacy toAgentUpdate in agent-update.ts — it is stateless, pure, and
 * handles all ACP-specific decoding:
 *
 *   - Extracts text from content blocks for message and thinking variants.
 *   - Extracts diff blocks from ToolCallContent arrays.
 *   - Passes status and kind through unchanged (no UI-level remapping here).
 *   - Sets parentToolCallId to null (providers enrich via EnrichHook).
 *   - Returns { kind: 'ignored' } for variants not yet rendered.
 */

import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import type { NormalizedDiff, NormalizedEvent, NormalizedToolStatus } from './normalized-event';

function extractDiffs(content: ReadonlyArray<ToolCallContent> | null | undefined): NormalizedDiff[] {
  if (!content) return [];
  const diffs: NormalizedDiff[] = [];
  for (const block of content) {
    if (block.type === 'diff') {
      diffs.push({ path: block.path, oldText: block.oldText ?? null, newText: block.newText });
    }
  }
  return diffs;
}

/**
 * Decode a raw ACP SessionUpdate into a NormalizedEvent.
 * Stateless — does not depend on turn or session context.
 */
export function decodeSessionUpdate(update: SessionUpdate): NormalizedEvent {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'message',
        role: 'user',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'agent_message_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'message',
        role: 'assistant',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'agent_thought_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'thinking',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'tool_call': {
      return {
        kind: 'tool_call',
        toolCallId: update.toolCallId,
        title: update.title,
        toolKind: update.kind ?? null,
        status: (update.status as NormalizedToolStatus | undefined) ?? null,
        parentToolCallId: null,
        diffs: extractDiffs(update.content),
      };
    }

    case 'tool_call_update': {
      return {
        kind: 'tool_update',
        toolCallId: update.toolCallId,
        title: update.title ?? null,
        toolKind: update.kind ?? null,
        status: (update.status as NormalizedToolStatus | undefined | null) ?? null,
        parentToolCallId: null,
        diffs: extractDiffs(update.content ?? undefined),
      };
    }

    case 'plan': {
      return {
        kind: 'plan',
        entries: update.entries.map((e) => ({
          content: e.content,
          status: e.status,
          priority: e.priority,
        })),
      };
    }

    // plan_update and plan_removed are UNSTABLE/ID-based ACP variants gated
    // behind PlanCapabilities — not emitted by Claude. Ignored for now.
    default:
      return { kind: 'ignored' };
  }
}

/**
 * The default ProviderTransform — pure baseline decode with no enrichment.
 * Suitable for providers that don't need _meta promotion.
 */
export const defaultTransform = decodeSessionUpdate;
