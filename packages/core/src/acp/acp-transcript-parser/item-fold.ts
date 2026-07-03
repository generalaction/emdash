/**
 * Item-level fold: NormalizedEvent → TranscriptItem[].
 *
 * foldItem applies one NormalizedEvent to an existing item list and returns
 * the updated list. This merges the two-step mapAgentUpdate + applyTurnEvent
 * pipeline from the renderer into a single direct fold, removing the
 * intermediate ActiveTurnEvent vocabulary.
 *
 * finalizeItems settles all in-progress streaming states for a turn that has
 * just been committed (message.streaming → false, thinking done + durationMs,
 * running tool/diff/execute → done, plan streaming → false).
 *
 * Both functions are pure and allocation-efficient: only changed items are
 * replaced; unchanged items are returned by reference.
 */

import type {
  NormalizedDiff,
  NormalizedEvent,
  NormalizedToolStatus,
} from './normalized-event';
import type {
  FileOpKind,
  ToolStatus,
  TranscriptDiff,
  TranscriptExecute,
  TranscriptFileOp,
  TranscriptItem,
  TranscriptMessage,
  TranscriptPlan,
  TranscriptThinking,
  TranscriptTool,
} from './model';
import {
  makeDiffId,
  makeMessageId,
  makeParentId,
  makePlanId,
  makeThinkingId,
  makeToolId,
} from './ids';

// ── Tool status mapping ─────────────────────────────────────────────────────

function mapToolStatus(status: NormalizedToolStatus | null | undefined): ToolStatus | undefined {
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

// ── Open-thinking finalization ──────────────────────────────────────────────

/**
 * Auto-finalize any open thinking rows when a non-thinking content event
 * arrives. Mirrors the renderer's applyFinalizeOpenThinking behavior.
 */
function finalizeOpenThinking(items: TranscriptItem[], now: number): TranscriptItem[] {
  let changed = false;
  const result = items.map((item) => {
    if (item.kind === 'thinking' && item.status === 'thinking') {
      changed = true;
      return {
        ...item,
        status: 'done' as const,
        durationMs: now - item.startedAt,
      } satisfies TranscriptThinking;
    }
    return item;
  });
  return changed ? result : items;
}

// ── Diff application helpers ────────────────────────────────────────────────

function applyDiffs(
  items: TranscriptItem[],
  toolId: string,
  parentId: string | undefined,
  diffs: NormalizedDiff[],
  status: NormalizedToolStatus | null
): TranscriptItem[] {
  let result = items;
  for (const d of diffs) {
    const id = makeDiffId(toolId, d.path);
    const mapped = mapToolStatus(status);
    const idx = result.findIndex((it) => it.kind === 'diff' && it.id === id);
    if (idx >= 0) {
      // Update existing diff row.
      const existing = result[idx] as TranscriptDiff;
      const updated: TranscriptDiff = {
        ...existing,
        ...(mapped !== undefined ? { status: mapped } : {}),
        oldText: d.oldText,
        newText: d.newText,
      };
      result = result.map((it, i) => (i === idx ? updated : it));
    } else {
      // Create new diff row.
      const newDiff: TranscriptDiff = {
        kind: 'diff',
        id,
        path: d.path,
        oldText: d.oldText,
        newText: d.newText,
        status: mapped ?? 'running',
        ...(parentId !== undefined ? { parentId } : {}),
      };
      result = [...result, newDiff];
    }
  }
  return result;
}

// ── foldItem ────────────────────────────────────────────────────────────────

/**
 * Apply one NormalizedEvent to a turn's item list, returning an updated list.
 * The turnId is used for id synthesis — all item ids are scoped to the turn.
 *
 * Content-bearing events (message, tool, diff, plan) auto-finalize any open
 * thinking rows before appending (the agent has moved past the reasoning phase).
 */
export function foldItem(items: TranscriptItem[], event: NormalizedEvent, turnId: string): TranscriptItem[] {
  const now = Date.now();

  switch (event.kind) {
    case 'message': {
      const id = makeMessageId(turnId, event.messageId, event.role);
      const base = finalizeOpenThinking(items, now);
      const idx = base.findIndex((it) => it.kind === 'message' && it.id === id);
      if (idx >= 0) {
        // Append chunk to existing message.
        const msg = base[idx] as TranscriptMessage;
        const updated: TranscriptMessage = {
          ...msg,
          text: msg.text + event.text,
          ...(event.attachments?.length
            ? { attachments: [...(msg.attachments ?? []), ...event.attachments] }
            : {}),
        };
        return base.map((it, i) => (i === idx ? updated : it));
      }
      // New message.
      const newMsg: TranscriptMessage = {
        kind: 'message',
        id,
        role: event.role,
        text: event.text,
        streaming: true,
        ...(event.attachments?.length ? { attachments: event.attachments } : {}),
      };
      return [...base, newMsg];
    }

    case 'thinking': {
      const id = makeThinkingId(turnId, event.messageId);
      const idx = items.findIndex((it) => it.kind === 'thinking' && it.id === id);
      if (idx >= 0) {
        const th = items[idx] as TranscriptThinking;
        return items.map((it, i) =>
          i === idx ? { ...th, text: th.text + event.text } : it
        );
      }
      const newThinking: TranscriptThinking = {
        kind: 'thinking',
        id,
        messageId: event.messageId,
        text: event.text,
        status: 'thinking',
        startedAt: now,
      };
      return [...items, newThinking];
    }

    case 'tool_call': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentId = makeParentId(turnId, event.parentToolCallId);
      const base = finalizeOpenThinking(items, now);

      // Edits with diffs: render ChatDiff rows, suppress generic tool placeholder.
      if (event.diffs.length > 0) {
        return applyDiffs(base, toolId, parentId, event.diffs, event.status);
      }

      // An edit toolKind with no diffs yet: suppress generic row — the diff
      // will arrive on a later tool_update. Return base unchanged.
      if (event.toolKind === 'edit') return base;

      // Generic tool row — idempotent creation.
      if (base.some((it) => it.kind === 'tool' && it.id === toolId)) return base;

      const newTool: TranscriptTool = {
        kind: 'tool',
        id: toolId,
        name: event.title,
        status: mapToolStatus(event.status) ?? 'running',
        ...(parentId !== undefined ? { parentId } : {}),
      };
      const mapped = mapToolStatus(event.status);
      // If already in a terminal state, create with that status directly.
      const withStatus: TranscriptTool =
        mapped !== undefined ? { ...newTool, status: mapped } : newTool;
      return [...base, withStatus];
    }

    case 'tool_update': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentId = makeParentId(turnId, event.parentToolCallId);

      // Diffs on update (edit whose diff arrives late).
      if (event.diffs.length > 0) {
        return applyDiffs(items, toolId, parentId, event.diffs, event.status);
      }

      // Update an existing tool row by id.
      const idx = items.findIndex((it) => it.kind === 'tool' && it.id === toolId);
      if (idx >= 0) {
        const tool = items[idx] as TranscriptTool;
        const mapped = mapToolStatus(event.status ?? undefined);
        const updated: TranscriptTool = {
          ...tool,
          ...(mapped !== undefined ? { status: mapped } : {}),
          ...(event.title !== null ? { name: event.title } : {}),
        };
        return items.map((it, i) => (i === idx ? updated : it));
      }

      // Late update for an unknown tool — create with current status.
      const mapped = mapToolStatus(event.status ?? undefined);
      const newTool: TranscriptTool = {
        kind: 'tool',
        id: toolId,
        name: event.title ?? 'unknown',
        status: mapped ?? 'running',
        ...(parentId !== undefined ? { parentId } : {}),
      };
      return [...items, newTool];
    }

    case 'plan': {
      const id = makePlanId(turnId);
      const base = finalizeOpenThinking(items, now);
      const idx = base.findIndex((it) => it.kind === 'plan' && it.id === id);
      if (idx >= 0) {
        const plan = base[idx] as TranscriptPlan;
        return base.map((it, i) =>
          i === idx ? { ...plan, entries: event.entries, streaming: true } : it
        );
      }
      const newPlan: TranscriptPlan = {
        kind: 'plan',
        id,
        entries: event.entries,
        streaming: true,
      };
      return [...base, newPlan];
    }

    case 'ignored':
    // Session-config / meta variants never reach foldItem (router intercepts them),
    // but the extended NormalizedEvent union requires a total switch.
    default:
      return items;
  }
}

// ── finalizeItems ───────────────────────────────────────────────────────────

/**
 * Settle all in-progress streaming states for a committed turn.
 *
 * - message.streaming → false
 * - thinking status 'thinking' → 'done' + computed durationMs
 * - tool status 'running' → 'done'
 * - file-op status 'running' → 'done'
 * - execute status 'running' → 'done' + computed durationMs
 * - diff status 'running' → 'done'
 * - plan.streaming → false
 * - resource-link status 'running' → 'done'
 *
 * Input must be plain objects (not Solid/MobX proxies).
 */
export function finalizeItems(items: TranscriptItem[]): TranscriptItem[] {
  const now = Date.now();
  return items.map((item): TranscriptItem => {
    switch (item.kind) {
      case 'message':
        return item.streaming ? { ...item, streaming: false } : item;
      case 'thinking':
        return item.status === 'thinking'
          ? { ...item, status: 'done' as const, durationMs: now - item.startedAt }
          : item;
      case 'tool':
        return item.status === 'running' ? { ...item, status: 'done' as const } : item;
      case 'file-op':
        return item.status === 'running' ? { ...item, status: 'done' as const } : item;
      case 'execute':
        return item.status === 'running'
          ? { ...item, status: 'done' as const, durationMs: item.durationMs ?? now - item.startedAt }
          : item;
      case 'diff':
        return item.status === 'running' ? { ...item, status: 'done' as const } : item;
      case 'plan':
        return item.streaming ? { ...item, streaming: false } : item;
      case 'resource-link':
        return item.status === 'running' ? { ...item, status: 'done' as const } : item;
    }
  });
}

// ── Utility: derive toolKind-aware FileOpKind ───────────────────────────────

/**
 * Map an ACP toolKind string to a FileOpKind for file-op row rendering.
 * Returns null if the toolKind does not represent a file operation.
 */
export function toFileOpKind(toolKind: string | null): FileOpKind | null {
  switch (toolKind) {
    case 'read':
      return 'read';
    case 'edit':
      return 'edit';
    case 'delete':
      return 'delete';
    case 'move':
      return 'move';
    default:
      return null;
  }
}
