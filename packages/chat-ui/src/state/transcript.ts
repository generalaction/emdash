/**
 * Solid transcript store — replaces the MobX TranscriptStore from @emdash/ui.
 *
 * Uses Solid's `createStore` with path-set mutations for fine-grained reactivity.
 * The two-tier pattern (committed + activeTurn) is preserved: committed items
 * are never mutated; activeTurn accumulates streaming state.
 */

import { createStore, produce } from 'solid-js/store';
import type {
  ChatItem,
  ChatMessage,
  ChatRole,
  ChatThinking,
  ChatToolCall,
  ToolStatus,
} from '../model';

export type TranscriptState = {
  committed: readonly ChatItem[];
  activeTurn: ChatItem[] | null;
};

export type TranscriptApi = {
  readonly state: TranscriptState;
  seed(history: ChatItem[]): void;
  appendMessageChunk(role: ChatRole, messageId: string, chunk: string): void;
  upsertTool(patch: Partial<ChatToolCall> & { id: string }): void;
  upsertThinking(patch: Partial<ChatThinking> & { id: string }): void;
  finalizeTurn(): void;
  reset(): void;
};

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

    appendMessageChunk(role, messageId, chunk) {
      setState(
        produce((s) => {
          if (s.activeTurn === null) s.activeTurn = [];
          const existing = s.activeTurn.find(
            (it): it is ChatMessage => it.kind === 'message' && it.id === messageId
          );
          if (existing) {
            existing.text += chunk;
          } else {
            s.activeTurn.push({
              kind: 'message',
              id: messageId,
              role,
              text: chunk,
              streaming: true,
            } satisfies ChatMessage);
          }
        })
      );
    },

    upsertTool(patch) {
      setState(
        produce((s) => {
          if (s.activeTurn === null) s.activeTurn = [];
          const existing = s.activeTurn.find(
            (it): it is ChatToolCall => it.kind === 'tool' && it.id === patch.id
          );
          if (existing) {
            if (patch.name !== undefined) existing.name = patch.name;
            if (patch.status !== undefined) existing.status = patch.status as ToolStatus;
            if (patch.inputSummary !== undefined) existing.inputSummary = patch.inputSummary;
            if (patch.detail !== undefined) existing.detail = patch.detail;
          } else {
            s.activeTurn.push({
              kind: 'tool',
              id: patch.id,
              name: patch.name ?? 'unknown',
              status: (patch.status ?? 'running') as ToolStatus,
              inputSummary: patch.inputSummary,
              detail: patch.detail,
            } satisfies ChatToolCall);
          }
        })
      );
    },

    upsertThinking(patch) {
      setState(
        produce((s) => {
          if (s.activeTurn === null) s.activeTurn = [];
          const existing = s.activeTurn.find(
            (it): it is ChatThinking => it.kind === 'thinking' && it.id === patch.id
          );
          if (existing) {
            if (patch.text !== undefined) existing.text = patch.text;
            if (patch.status !== undefined) existing.status = patch.status;
            if (patch.durationMs !== undefined) existing.durationMs = patch.durationMs;
          } else {
            s.activeTurn.push({
              kind: 'thinking',
              id: patch.id,
              status: patch.status ?? 'thinking',
              text: patch.text ?? '',
              startedAt: patch.startedAt ?? Date.now(),
              durationMs: patch.durationMs,
            } satisfies ChatThinking);
          }
        })
      );
    },

    finalizeTurn() {
      setState(
        produce((s) => {
          if (!s.activeTurn) return;
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
            return item;
          });
          s.committed = [...s.committed, ...finalized];
          s.activeTurn = null;
        })
      );
    },

    reset() {
      setState({ committed: [], activeTurn: null });
    },
  };
}
