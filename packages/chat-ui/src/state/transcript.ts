/**
 * Solid transcript store.
 *
 * Uses Solid's `createStore` with path-set mutations for fine-grained reactivity.
 * The two-tier pattern (committed + activeTurn) is preserved: committed items
 * are never mutated; activeTurn accumulates streaming state.
 *
 * The public write surface is a single `dispatch(event)` method. All mutation
 * logic lives in the reducer switch, keeping callers free of internal state
 * details (delta accumulation, startedAt timing, turn lifecycle).
 */

import { createStore, produce } from 'solid-js/store';
import type {
  ChatDiff,
  ChatExecute,
  ChatFileOpToolCall,
  ChatItem,
  ChatMessage,
  ChatPlan,
  ChatPlanEntry,
  ChatRole,
  ChatThinking,
  ChatToolCall,
  FileOp,
  FileOpKind,
  ToolStatus,
} from '../model';

export type TranscriptState = {
  committed: readonly ChatItem[];
  activeTurn: ChatItem[] | null;
};

// ── Event union ───────────────────────────────────────────────────────────────

export type TranscriptEvent =
  /** A text chunk for a message (user or assistant). Delta — appended. */
  | { type: 'message_chunk'; id: string; role: ChatRole; text: string }
  /** A new tool call has started. */
  | { type: 'tool_start'; id: string; name: string; inputSummary?: string }
  /** An existing tool call was updated (status, name, or summary). */
  | {
      type: 'tool_update';
      id: string;
      status?: ToolStatus;
      name?: string;
      inputSummary?: string;
    }
  /**
   * A chunk of reasoning text. Delta — appended to the thinking row's text.
   * On first dispatch for a given id the row is created with `startedAt` set
   * to the provided value or the current timestamp.
   */
  | { type: 'thinking_chunk'; id: string; text: string; startedAt?: number }
  /**
   * Reasoning is complete. Freezes status to 'done' and records durationMs
   * (explicit value, or computed from startedAt).
   */
  | { type: 'thinking_done'; id: string; durationMs?: number }
  /** A new file-operation tool call has started. */
  | { type: 'file_op_start'; id: string; op: FileOpKind; ops: FileOp[] }
  /**
   * An existing file-operation tool call was updated.
   * `ops` replaces the full file list when provided (not appended).
   */
  | { type: 'file_op_update'; id: string; status?: ToolStatus; ops?: FileOp[] }
  /**
   * A new execute tool call has started.
   * `command` may be empty string initially; it is filled by `execute_update`.
   */
  | { type: 'execute_start'; id: string; command: string; startedAt?: number }
  /**
   * An existing execute tool call was updated.
   * `command` is patched when provided.
   */
  | {
      type: 'execute_update';
      id: string;
      command?: string;
      status?: ToolStatus;
    }
  /**
   * A new diff preview has started (one per changed file within an edit tool call).
   * `id` must be unique per file: `${toolCallId}:${path}`.
   */
  | {
      type: 'diff_start';
      id: string;
      path: string;
      oldText: string | null;
      newText: string;
    }
  /**
   * An existing diff row was updated (status, or new text if content evolved).
   */
  | {
      type: 'diff_update';
      id: string;
      status?: ToolStatus;
      oldText?: string | null;
      newText?: string;
    }
  /**
   * A plan row was created or updated. `entries` replaces the full task list
   * (ACP plans are sent wholesale on each update). On first dispatch for a
   * given id the row is created. `streaming` defaults to true on create so the
   * collapsed preview auto-scrolls as tasks arrive; set it false (or rely on
   * `turn_done`) to settle the row.
   */
  | { type: 'plan_update'; id: string; entries: ChatPlanEntry[]; streaming?: boolean }
  /** A plan row was removed (ACP `plan_removed`). */
  | { type: 'plan_removed'; id: string }
  /**
   * The current turn is finished. Clears `streaming` flags, finalizes any
   * still-active thinking and execute rows, and moves activeTurn into committed.
   */
  | { type: 'turn_done' };

// ── Public API ────────────────────────────────────────────────────────────────

export type TranscriptApi = {
  readonly state: TranscriptState;
  /** Replace the entire transcript with historical items (e.g. on session replay). */
  seed(history: ChatItem[]): void;
  /** Feed a turn event into the transcript. */
  dispatch(event: TranscriptEvent): void;
  /** Clear all state (e.g. at the start of a replay). */
  reset(): void;
  /**
   * Prepend older history items before the existing committed items without
   * touching activeTurn. Items must be stable object references — the engine's
   * identity-based node memo is keyed by reference.
   */
  prependHistory(items: ChatItem[]): void;
  /**
   * Returns the absolute index (committed-first) of the item with the given id,
   * or -1 if not found.
   */
  findIndexById(id: string): number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Total item count across both tiers. */
export function itemCount(state: TranscriptState): number {
  return state.committed.length + (state.activeTurn?.length ?? 0);
}

/** Get item at absolute index (committed first, then activeTurn). */
export function getItem(state: TranscriptState, i: number): ChatItem | undefined {
  const cl = state.committed.length;
  if (i < cl) return state.committed[i];
  return state.activeTurn?.[i - cl];
}

/** All items as a readonly array (allocates — use getItem for reactive per-index access). */
export function allItems(state: TranscriptState): readonly ChatItem[] {
  if (!state.activeTurn || state.activeTurn.length === 0) return state.committed;
  return [...state.committed, ...state.activeTurn];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTranscript(): TranscriptApi {
  const [state, setState] = createStore<TranscriptState>({
    committed: [],
    activeTurn: null,
  });

  // id → committed index map; rebuilt on seed/prepend, patched on turn_done.
  const idMap = new Map<string, number>();

  const rebuildIdMap = (items: readonly ChatItem[]): void => {
    idMap.clear();
    for (let i = 0; i < items.length; i++) {
      idMap.set(items[i].id, i);
    }
  };

  return {
    state,

    seed(history) {
      setState({ committed: [...history], activeTurn: null });
      rebuildIdMap(history);
    },

    prependHistory(items) {
      if (items.length === 0) return;
      setState('committed', (prev) => [...items, ...prev]);
      // Rebuild: indices of all existing committed items shifted by items.length.
      rebuildIdMap(state.committed);
    },

    findIndexById(id) {
      // Check committed first via fast map.
      const ci = idMap.get(id);
      if (ci !== undefined) return ci;
      // Fall back to activeTurn scan (small; not worth a separate map).
      const at = state.activeTurn;
      if (at) {
        const offset = state.committed.length;
        for (let i = 0; i < at.length; i++) {
          if (at[i].id === id) return offset + i;
        }
      }
      return -1;
    },

    dispatch(event) {
      setState(
        produce((s) => {
          /**
           * Auto-finalize any still-active thinking row when a content event
           * that follows reasoning arrives.  This stops the thinking header from
           * shimmering "Thinking Ns" mid-turn once the agent transitions from
           * reasoning to response — no explicit `thinking_done` signal required.
           */
          const finalizeOpenThinking = (): void => {
            if (!s.activeTurn) return;
            for (const item of s.activeTurn) {
              if (item.kind === 'thinking' && item.status === 'thinking') {
                item.status = 'done';
                item.durationMs = Date.now() - item.startedAt;
              }
            }
          };

          switch (event.type) {
            case 'message_chunk': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatMessage => it.kind === 'message' && it.id === event.id
              );
              if (existing) {
                existing.text += event.text;
              } else {
                s.activeTurn.push({
                  kind: 'message',
                  id: event.id,
                  role: event.role,
                  text: event.text,
                  streaming: true,
                } satisfies ChatMessage);
              }
              break;
            }

            case 'tool_start': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatToolCall => it.kind === 'tool' && it.id === event.id
              );
              if (!existing) {
                s.activeTurn.push({
                  kind: 'tool',
                  id: event.id,
                  name: event.name,
                  status: 'running',
                  inputSummary: event.inputSummary,
                } satisfies ChatToolCall);
              }
              break;
            }

            case 'tool_update': {
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatToolCall => it.kind === 'tool' && it.id === event.id
              );
              if (existing) {
                if (event.status !== undefined) existing.status = event.status;
                if (event.name !== undefined) existing.name = event.name;
                if (event.inputSummary !== undefined) existing.inputSummary = event.inputSummary;
              } else {
                // Defensive: handle update arriving before start
                s.activeTurn.push({
                  kind: 'tool',
                  id: event.id,
                  name: event.name ?? 'unknown',
                  status: event.status ?? 'running',
                  inputSummary: event.inputSummary,
                } satisfies ChatToolCall);
              }
              break;
            }

            case 'thinking_chunk': {
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatThinking => it.kind === 'thinking' && it.id === event.id
              );
              if (existing) {
                existing.text += event.text;
              } else {
                s.activeTurn.push({
                  kind: 'thinking',
                  id: event.id,
                  status: 'thinking',
                  text: event.text,
                  startedAt: event.startedAt ?? Date.now(),
                } satisfies ChatThinking);
              }
              break;
            }

            case 'thinking_done': {
              if (!s.activeTurn) break;
              const existing = s.activeTurn.find(
                (it): it is ChatThinking => it.kind === 'thinking' && it.id === event.id
              );
              if (existing) {
                existing.status = 'done';
                existing.durationMs = event.durationMs ?? Date.now() - existing.startedAt;
              }
              break;
            }

            case 'file_op_start': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatFileOpToolCall => it.kind === 'file-op' && it.id === event.id
              );
              if (!existing) {
                s.activeTurn.push({
                  kind: 'file-op',
                  id: event.id,
                  op: event.op,
                  status: 'running',
                  ops: event.ops,
                } satisfies ChatFileOpToolCall);
              }
              break;
            }

            case 'file_op_update': {
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatFileOpToolCall => it.kind === 'file-op' && it.id === event.id
              );
              if (existing) {
                if (event.status !== undefined) existing.status = event.status;
                if (event.ops !== undefined) existing.ops = event.ops;
              } else {
                // Defensive: handle update arriving before start
                s.activeTurn.push({
                  kind: 'file-op',
                  id: event.id,
                  op: 'read',
                  status: event.status ?? 'running',
                  ops: event.ops ?? [],
                } satisfies ChatFileOpToolCall);
              }
              break;
            }

            case 'execute_start': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatExecute => it.kind === 'execute' && it.id === event.id
              );
              if (!existing) {
                s.activeTurn.push({
                  kind: 'execute',
                  id: event.id,
                  command: event.command,
                  status: 'running',
                  startedAt: event.startedAt ?? Date.now(),
                } satisfies ChatExecute);
              }
              break;
            }

            case 'execute_update': {
              if (s.activeTurn === null) s.activeTurn = [];
              const existing = s.activeTurn.find(
                (it): it is ChatExecute => it.kind === 'execute' && it.id === event.id
              );
              if (existing) {
                if (event.command !== undefined) existing.command = event.command;
                if (event.status !== undefined) {
                  existing.status = event.status;
                  if (event.status === 'done' && existing.durationMs === undefined) {
                    existing.durationMs = Date.now() - existing.startedAt;
                  }
                }
              } else {
                // Defensive: handle update arriving before start
                s.activeTurn.push({
                  kind: 'execute',
                  id: event.id,
                  command: event.command ?? '',
                  status: event.status ?? 'running',
                  startedAt: Date.now(),
                } satisfies ChatExecute);
              }
              break;
            }

            case 'diff_start': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existingDiff = s.activeTurn.find(
                (it): it is ChatDiff => it.kind === 'diff' && it.id === event.id
              );
              if (!existingDiff) {
                s.activeTurn.push({
                  kind: 'diff',
                  id: event.id,
                  path: event.path,
                  oldText: event.oldText,
                  newText: event.newText,
                  status: 'running',
                } satisfies ChatDiff);
              }
              break;
            }

            case 'diff_update': {
              if (s.activeTurn === null) s.activeTurn = [];
              const existingDiff = s.activeTurn.find(
                (it): it is ChatDiff => it.kind === 'diff' && it.id === event.id
              );
              if (existingDiff) {
                if (event.status !== undefined) existingDiff.status = event.status;
                if (event.oldText !== undefined) existingDiff.oldText = event.oldText;
                if (event.newText !== undefined) existingDiff.newText = event.newText;
              }
              break;
            }

            case 'plan_update': {
              finalizeOpenThinking();
              if (s.activeTurn === null) s.activeTurn = [];
              const existingPlan = s.activeTurn.find(
                (it): it is ChatPlan => it.kind === 'plan' && it.id === event.id
              );
              if (existingPlan) {
                // ACP plans replace the full entry list on each update.
                existingPlan.entries = event.entries;
                if (event.streaming !== undefined) existingPlan.streaming = event.streaming;
              } else {
                s.activeTurn.push({
                  kind: 'plan',
                  id: event.id,
                  entries: event.entries,
                  streaming: event.streaming ?? true,
                } satisfies ChatPlan);
              }
              break;
            }

            case 'plan_removed': {
              if (!s.activeTurn) break;
              s.activeTurn = s.activeTurn.filter(
                (it) => !(it.kind === 'plan' && it.id === event.id)
              );
              break;
            }

            case 'turn_done': {
              if (!s.activeTurn) break;
              const finalized: ChatItem[] = s.activeTurn.map((item) => {
                if (item.kind === 'message' && item.streaming) {
                  return { ...item, streaming: false };
                }
                if (item.kind === 'thinking' && item.status === 'thinking') {
                  return {
                    ...item,
                    status: 'done' as const,
                    durationMs: Date.now() - item.startedAt,
                  };
                }
                if (item.kind === 'execute' && item.status === 'running') {
                  return {
                    ...item,
                    status: 'done' as const,
                    durationMs: Date.now() - item.startedAt,
                  };
                }
                if (item.kind === 'diff' && item.status === 'running') {
                  return { ...item, status: 'done' as const };
                }
                if (item.kind === 'plan' && item.streaming) {
                  return { ...item, streaming: false };
                }
                return item;
              });
              const offset = s.committed.length;
              s.committed = [...s.committed, ...finalized];
              s.activeTurn = null;
              // Patch idMap: only new items added at the tail.
              for (let i = 0; i < finalized.length; i++) {
                idMap.set(finalized[i].id, offset + i);
              }
              break;
            }
          }
        })
      );
    },

    reset() {
      setState({ committed: [], activeTurn: null });
      idMap.clear();
    },
  };
}
