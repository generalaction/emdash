/**
 * emdash-owned, provider-neutral agent update vocabulary.
 *
 * Every inbound ACP `SessionUpdate` is converted to an `AgentUpdate` in the main
 * process by `toAgentUpdate` before being stored in `AcpTurn.updates` or emitted
 * over IPC.  Provider plugins may further enrich the result via the optional
 * `IAcpBehavior.enrich` hook to promote vendor-specific `_meta` fields (e.g.
 * `_meta.claudeCode.parentToolUseId`) into first-class fields such as
 * `parentToolCallId`.
 *
 */

import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';


export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AgentPlanEntryStatus = 'pending' | 'in_progress' | 'completed';
export type AgentPlanEntryPriority = 'high' | 'medium' | 'low';
export interface AgentPlanEntry {
  content: string;
  status: AgentPlanEntryStatus;
  priority: AgentPlanEntryPriority;
}

export interface AgentDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

export type AgentUpdate =
  | {
      kind: 'message';
      role: 'user' | 'assistant';
      messageId: string | null;
      text: string;
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
      /** ACP `ToolKind` passthrough ('edit', 'execute', 'think', ...). */
      toolKind: string | null;
      status: AgentToolStatus | null;
      /**
       * Tool call id of the parent when this call was produced by a nested
       * subagent invocation. `null` in the baseline; provider plugins promote
       * vendor `_meta` into this field via `IAcpBehavior.enrich`.
       */
      parentToolCallId: string | null;
      diffs: AgentDiff[];
    }
  | {
      kind: 'tool_update';
      toolCallId: string;
      title: string | null;
      toolKind: string | null;
      status: AgentToolStatus | null;
      parentToolCallId: string | null;
      diffs: AgentDiff[];
    }
  /**
   * Agent execution plan — driven by the ACP stable `plan` session update.
   * Entries replace the plan wholesale on each update (ACP semantics).
   */
  | { kind: 'plan'; entries: AgentPlanEntry[] }
  /**
   * Catch-all for variants not yet rendered by the client:
   * `plan_update` (UNSTABLE/ID-based), `plan_removed` (UNSTABLE/ID-based),
   * `available_commands_update`, `current_mode_update`, `config_option_update`,
   * `session_info_update`, `usage_update`, and any non-text message/thinking content.
   * Preserves today's behaviour (nothing rendered).
   */
  | { kind: 'ignored' };

interface AcpDiffBlock {
  path: string;
  oldText: string | null;
  newText: string;
}

function extractDiffs(content: ReadonlyArray<ToolCallContent> | null | undefined): AcpDiffBlock[] {
  if (!content) return [];
  const diffs: AcpDiffBlock[] = [];
  for (const block of content) {
    if (block.type === 'diff') {
      diffs.push({ path: block.path, oldText: block.oldText ?? null, newText: block.newText });
    }
  }
  return diffs;
}

/**
 * Converts a raw ACP `SessionUpdate` into the provider-neutral `AgentUpdate`
 * vocabulary.  This function performs all ACP-specific decoding:
 *   - Extracts text from `content` blocks for message and thinking variants.
 *   - Extracts diff blocks from `ToolCallContent` arrays.
 *   - Passes `status` and `kind` through unchanged (no UI-level remapping here).
 *   - Sets `parentToolCallId` to `null` (providers enrich this via `IAcpBehavior.enrich`).
 *
 * Returns `{ kind: 'ignored' }` for variants not yet rendered by the client.
 */
export function toAgentUpdate(update: SessionUpdate): AgentUpdate {
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
        status: (update.status as AgentToolStatus | undefined) ?? null,
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
        status: (update.status as AgentToolStatus | undefined | null) ?? null,
        parentToolCallId: null,
        diffs: extractDiffs(update.content ?? undefined),
      };
    }

    case 'plan':
      return {
        kind: 'plan',
        entries: update.entries.map((e) => ({
          content: e.content,
          status: e.status,
          priority: e.priority,
        })),
      };

    // `plan_update` and `plan_removed` are UNSTABLE/ID-based ACP variants gated
    // behind PlanCapabilities — not emitted by Claude. Leave as ignored for now.
    default:
      return { kind: 'ignored' };
  }
}
