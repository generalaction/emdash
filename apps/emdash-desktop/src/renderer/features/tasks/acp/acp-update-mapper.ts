/**
 * Pure mapping functions that translate AgentUpdate events into the
 * ActiveTurnEvent vocabulary consumed by @emdash/chat-ui.
 *
 * ACP-specific decoding (text extraction, diff extraction, status/kind
 * passthrough) is handled upstream in core by `toAgentUpdate`. This mapper
 * is a thin adapter: it converts the provider-neutral `AgentUpdate` fields
 * into the UI vocabulary, keeping all UI-specific decisions here.
 */

import { applyTurnEvent, finalizeTurn } from '@emdash/chat-ui';
import type { ActiveTurnEvent, ChatItem, ToolStatus } from '@emdash/chat-ui';
import type { AgentDiff, AgentToolStatus, AgentUpdate, AcpTurn, ChatHistory } from '@emdash/core/acp';

// ── AgentToolStatus → ToolStatus mapping ──────────────────────────────────────

function mapToolStatus(status: AgentToolStatus | null | undefined): ToolStatus | undefined {
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

// ── Core mapper ───────────────────────────────────────────────────────────────

/**
 * Maps a single AgentUpdate to zero or more ActiveTurnEvents.
 */
export function mapAgentUpdate(update: AgentUpdate): ActiveTurnEvent[] {
  switch (update.kind) {
    case 'message': {
      if (!update.text) return [];
      return [
        {
          type: 'message_chunk',
          id: update.messageId ?? (update.role === 'user' ? 'user-message' : 'agent-message'),
          role: update.role,
          text: update.text,
        },
      ];
    }

    case 'thinking': {
      if (!update.text) return [];
      return [{ type: 'thinking_chunk', id: update.messageId ?? 'thinking', text: update.text }];
    }

    case 'tool_call': {
      const { toolCallId, title, toolKind, status, diffs } = update;

      // Edits carry their changes as diff content blocks → render ChatDiff rows.
      if (diffs.length > 0) {
        return diffs.flatMap((d: AgentDiff) => {
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

      // An edit whose diff arrives in a later tool_update: suppress the
      // generic tool row so it isn't rendered as a placeholder beside the diff.
      if (toolKind === 'edit') return [];

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

    case 'tool_update': {
      const { toolCallId, title, status, diffs } = update;

      if (diffs.length > 0) {
        return diffs.flatMap((d: AgentDiff) => {
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
      // ACP's stable `plan` update carries no id — use a constant so the reducer
      // replaces the same row in place on each wholesale update. `streaming: true`
      // enables the shimmer/auto-scroll; finalizeTurn settles it to false at turn end.
      return [
        {
          type: 'plan_update',
          id: 'plan',
          entries: update.entries,
          streaming: true,
        },
      ];

    case 'ignored':
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
    const events = mapAgentUpdate(update);
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
