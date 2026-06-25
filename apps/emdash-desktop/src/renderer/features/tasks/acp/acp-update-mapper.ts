/**
 * Pure mapping functions that translate ACP SessionUpdate events into the
 * ActiveTurnEvent vocabulary consumed by @emdash/chat-ui.
 *
 * Only foundational variants are mapped here; the rest are stubbed with TODO
 * comments so they can be wired up incrementally.
 */

import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import { applyTurnEvent, finalizeTurn } from '@emdash/chat-ui';
import type { ActiveTurnEvent, ChatItem, ToolStatus } from '@emdash/chat-ui';
import type { AcpTurn, ChatHistory } from '@emdash/core/acp';

// ── ToolCallStatus → ToolStatus mapping ───────────────────────────────────────

type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

function mapToolStatus(status: AcpToolStatus | null | undefined): ToolStatus | undefined {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return undefined;
  }
}

// ── Diff content extraction ───────────────────────────────────────────────────

interface AcpDiffBlock {
  path: string;
  oldText: string | null;
  newText: string;
}

/**
 * Pulls `type: 'diff'` blocks out of a tool call's content array. ACP delivers
 * file edits as diff content blocks (one per changed file) on `tool_call` /
 * `tool_call_update` updates; the chat-ui renders each as a ChatDiff row.
 */
function extractDiffs(content: readonly ToolCallContent[] | null | undefined): AcpDiffBlock[] {
  if (!content) return [];
  const diffs: AcpDiffBlock[] = [];
  for (const block of content) {
    if (block.type === 'diff') {
      diffs.push({ path: block.path, oldText: block.oldText ?? null, newText: block.newText });
    }
  }
  return diffs;
}

// ── Core mapper ───────────────────────────────────────────────────────────────

/**
 * Maps a single ACP SessionUpdate to zero or more ActiveTurnEvents.
 * Foundational variants: user/agent message chunks, thinking chunks, tool calls.
 * Other variants return [] with inline TODO markers.
 */
export function mapSessionUpdate(update: SessionUpdate): ActiveTurnEvent[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      const { content, messageId } = update;
      if (content.type === 'text' && content.text) {
        return [
          {
            type: 'message_chunk',
            id: messageId ?? 'user-message',
            role: 'user',
            text: content.text,
          },
        ];
      }
      // TODO: handle image / resource_link content blocks in user messages
      return [];
    }

    case 'agent_message_chunk': {
      const { content, messageId } = update;
      if (content.type === 'text' && content.text) {
        return [
          {
            type: 'message_chunk',
            id: messageId ?? 'agent-message',
            role: 'assistant',
            text: content.text,
          },
        ];
      }
      // TODO: handle image / resource_link content blocks in agent messages
      return [];
    }

    case 'agent_thought_chunk': {
      const { content, messageId } = update;
      if (content.type === 'text' && content.text) {
        return [{ type: 'thinking_chunk', id: messageId ?? 'thinking', text: content.text }];
      }
      return [];
    }

    case 'tool_call': {
      const { toolCallId, title, status, kind, content } = update;

      // Edits carry their changes as diff content blocks → render ChatDiff rows.
      const diffs = extractDiffs(content);
      if (diffs.length > 0) {
        return diffs.flatMap((d) => {
          const id = `${toolCallId}:${d.path}`;
          const events: ActiveTurnEvent[] = [
            { type: 'diff_start', id, path: d.path, oldText: d.oldText, newText: d.newText },
          ];
          if (status && status !== 'in_progress' && status !== 'pending') {
            events.push({ type: 'diff_update', id, status: mapToolStatus(status) });
          }
          return events;
        });
      }

      // An edit whose diff arrives in a later tool_call_update: suppress the
      // generic tool row so it isn't rendered as a placeholder beside the diff.
      if (kind === 'edit') return [];

      return [
        {
          type: 'tool_start',
          id: toolCallId,
          name: title,
          inputSummary: undefined,
        },
        // If the tool_call already carries a terminal status, emit a follow-up update.
        ...(status && status !== 'in_progress' && status !== 'pending'
          ? [
              {
                type: 'tool_update' as const,
                id: toolCallId,
                status: mapToolStatus(status),
              },
            ]
          : []),
      ];
    }

    case 'tool_call_update': {
      const { toolCallId, status, title, content } = update;

      const diffs = extractDiffs(content);
      if (diffs.length > 0) {
        return diffs.flatMap((d) => {
          const id = `${toolCallId}:${d.path}`;
          return [
            // diff_start is idempotent in the reducer; safe if the row already exists.
            {
              type: 'diff_start',
              id,
              path: d.path,
              oldText: d.oldText,
              newText: d.newText,
            } satisfies ActiveTurnEvent,
            {
              type: 'diff_update',
              id,
              status: mapToolStatus(status ?? undefined),
              oldText: d.oldText,
              newText: d.newText,
            } satisfies ActiveTurnEvent,
          ];
        });
      }

      return [
        {
          type: 'tool_update',
          id: toolCallId,
          status: mapToolStatus(status ?? undefined),
          name: title ?? undefined,
        },
      ];
    }

    case 'plan':
    case 'plan_update':
    case 'plan_removed':
      // TODO: map plan events to plan_update / plan_removed ActiveTurnEvents
      return [];

    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
      return [];

    default:
      return [];
  }
}

// ── Turn / history folders ────────────────────────────────────────────────────

/**
 * Folds a single AcpTurn's ordered updates into finalized ChatItem[].
 * Suitable for committed turns where all streaming has concluded.
 */
export function foldTurn(turn: AcpTurn): ChatItem[] {
  let items: ChatItem[] = [];
  for (const { update } of turn.updates) {
    const events = mapSessionUpdate(update);
    for (const event of events) {
      items = applyTurnEvent(items, event);
    }
  }
  return finalizeTurn(items);
}

/**
 * Flattens all committed turns in a ChatHistory into a single ChatItem[].
 * Used to seed the initial transcript on store mount.
 */
export function foldHistory(history: ChatHistory): ChatItem[] {
  return history.turns.flatMap((turn) => foldTurn(turn));
}
