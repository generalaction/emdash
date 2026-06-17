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
  ChatExecute,
  ChatFileOpToolCall,
  ChatItem,
  ChatMessage,
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
  | { type: 'tool_start'; id: string; name: string; inputSummary?: string; detail?: string }
  /** An existing tool call was updated (status, name, summary, or detail). */
  | {
      type: 'tool_update';
      id: string;
      status?: ToolStatus;
      name?: string;
      inputSummary?: string;
      detail?: string;
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

  return {
    state,

    seed(history) {
      setState({ committed: [...history], activeTurn: null });
    },

    dispatch(event) {
      setState(
        produce((s) => {
          switch (event.type) {
            case 'message_chunk': {
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
                  detail: event.detail,
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
                if (event.detail !== undefined) existing.detail = event.detail;
              } else {
                // Defensive: handle update arriving before start
                s.activeTurn.push({
                  kind: 'tool',
                  id: event.id,
                  name: event.name ?? 'unknown',
                  status: event.status ?? 'running',
                  inputSummary: event.inputSummary,
                  detail: event.detail,
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
                return item;
              });
              s.committed = [...s.committed, ...finalized];
              s.activeTurn = null;
              break;
            }
          }
        })
      );
    },

    reset() {
      setState({ committed: [], activeTurn: null });
    },
  };
}
