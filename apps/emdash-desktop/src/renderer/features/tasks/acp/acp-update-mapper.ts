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
import type { ActiveTurnEvent, ChatImageAttachment, ChatItem, ToolStatus } from '@emdash/chat-ui';
import type {
  AgentDiff,
  AgentToolStatus,
  AgentUpdate,
  AcpTurn,
  ChatHistory,
} from '@emdash/core/acp';

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
 *
 * `turnId` is used to scope every emitted id to the current turn so that items
 * from different committed turns never share an id. A kind-tag prefix also
 * disambiguates `thinking` from `message` when ACP reuses the same `messageId`
 * across both update kinds (Claude's standard behaviour).
 */
export function mapAgentUpdate(update: AgentUpdate, turnId: string): ActiveTurnEvent[] {
  switch (update.kind) {
    case 'message': {
      const images = update.images ?? [];
      if (!update.text && images.length === 0) return [];
      const msgSuffix = update.messageId ?? update.role;
      const attachments: ChatImageAttachment[] = images.map((img, i) => ({
        id: `${turnId}:message:${msgSuffix}:img:${i}`,
        name: img.name ?? `image-${i + 1}`,
        dataUrl: `data:${img.mimeType};base64,${img.data}`,
      }));
      return [
        {
          type: 'message_chunk',
          id: `${turnId}:message:${msgSuffix}`,
          role: update.role,
          text: update.text,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      ];
    }

    case 'thinking': {
      if (!update.text) return [];
      const thinkSuffix = update.messageId ?? 'main';
      return [
        { type: 'thinking_chunk', id: `${turnId}:thinking:${thinkSuffix}`, text: update.text },
      ];
    }

    case 'tool_call': {
      const { toolCallId, title, toolKind, status, diffs } = update;
      const toolId = `${turnId}:${toolCallId}`;

      // Edits carry their changes as diff content blocks → render ChatDiff rows.
      if (diffs.length > 0) {
        return diffs.flatMap((d: AgentDiff) => {
          const id = `${toolId}:${d.path}`;
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
          id: toolId,
          name: title,
          inputSummary: undefined,
        },
        // If the tool_call already carries a terminal status, emit a follow-up update.
        ...(status && status !== 'in_progress' && status !== 'pending'
          ? [
              {
                type: 'tool_update' as const,
                id: toolId,
                status: mapToolStatus(status),
              },
            ]
          : []),
      ];
    }

    case 'tool_update': {
      const { toolCallId, title, status, diffs } = update;
      const toolId = `${turnId}:${toolCallId}`;

      if (diffs.length > 0) {
        return diffs.flatMap((d: AgentDiff) => {
          const id = `${toolId}:${d.path}`;
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
          id: toolId,
          status: mapToolStatus(status ?? undefined),
          name: title ?? undefined,
        },
      ];
    }

    case 'plan':
      // Scope to the turn so that `plan` items from different committed turns
      // carry distinct ids. `streaming: true` enables the shimmer/auto-scroll;
      // finalizeTurn settles it to false at turn end.
      return [
        {
          type: 'plan_update',
          id: `${turnId}:plan`,
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
    const events = mapAgentUpdate(update, turn.id);
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
