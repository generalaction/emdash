/**
 * TranscriptStore — two-tier MobX store for chat message history.
 *
 * Tier 1 – committed  (`observable.ref`, never mutated):
 *   An immutable frozen array of finalised ChatItems. Replaced atomically
 *   each time finalizeTurn() is called. Downstream computed values that depend
 *   only on committed items re-compute exactly once per turn rather than on
 *   every streaming chunk.
 *
 * Tier 2 – activeTurn (`observable`, deep):
 *   A small mutable array that accumulates streaming chunks for the current
 *   agent turn. Observers here update on every chunk.
 *
 * The `items` getter splices both tiers together for the virtualizer.
 */

import { makeAutoObservable, observable } from 'mobx';
import type {
  ChatItem,
  ChatMessage,
  ChatRole,
  ChatThinking,
  ChatToolCall,
  ToolStatus,
} from '../model';

export class TranscriptStore {
  /** Frozen, committed history.  Uses observable.ref so the whole array is tracked
   *  as an atomic reference, not item-by-item. */
  committed: ReadonlyArray<ChatItem> = [];

  /** Currently accumulating agent turn.  Deep observable so each chunk triggers updates. */
  activeTurn: ChatItem[] | null = null;

  constructor() {
    makeAutoObservable(this, {
      committed: observable.ref,
    });
  }

  // ── Public read API ─────────────────────────────────────────────────────────

  /** All items in display order (committed history + in-progress turn). */
  get items(): ReadonlyArray<ChatItem> {
    if (this.activeTurn === null || this.activeTurn.length === 0) {
      return this.committed;
    }
    return [...this.committed, ...this.activeTurn];
  }

  // ── Mutation API ────────────────────────────────────────────────────────────

  /**
   * Seed the store with a completed history (e.g. on conversation load).
   * Replaces both tiers.
   */
  seed(history: ChatItem[]): void {
    this.committed = Object.freeze([...history]);
    this.activeTurn = null;
  }

  /**
   * Append a streaming text chunk to the current turn.
   * Creates a new message item if none exists for `messageId`, or appends to it.
   */
  appendMessageChunk(role: ChatRole, messageId: string, chunk: string): void {
    if (this.activeTurn === null) this.activeTurn = [];

    const existing = this.activeTurn.find(
      (it): it is ChatMessage => it.kind === 'message' && it.id === messageId
    );
    if (existing) {
      existing.text += chunk;
    } else {
      this.activeTurn.push({
        kind: 'message',
        id: messageId,
        role,
        text: chunk,
        streaming: true,
      } satisfies ChatMessage);
    }
  }

  /**
   * Insert or update a tool call in the active turn.
   * Matches by `id`; if not found, appends a new tool item.
   */
  upsertTool(patch: Partial<ChatToolCall> & { id: string }): void {
    if (this.activeTurn === null) this.activeTurn = [];

    const existing = this.activeTurn.find(
      (it): it is ChatToolCall => it.kind === 'tool' && it.id === patch.id
    );
    if (existing) {
      if (patch.name !== undefined) existing.name = patch.name;
      if (patch.status !== undefined) existing.status = patch.status as ToolStatus;
      if (patch.inputSummary !== undefined) existing.inputSummary = patch.inputSummary;
      if (patch.detail !== undefined) existing.detail = patch.detail;
    } else {
      this.activeTurn.push({
        kind: 'tool',
        id: patch.id,
        name: patch.name ?? 'unknown',
        status: (patch.status ?? 'running') as ToolStatus,
        inputSummary: patch.inputSummary,
        detail: patch.detail,
      } satisfies ChatToolCall);
    }
  }

  /**
   * Insert or update a thinking item in the active turn.
   * Matches by `id`; if not found, appends a new thinking item.
   * Pass `status: 'done'` with `durationMs` to freeze the row.
   */
  upsertThinking(patch: Partial<ChatThinking> & { id: string }): void {
    if (this.activeTurn === null) this.activeTurn = [];

    const existing = this.activeTurn.find(
      (it): it is ChatThinking => it.kind === 'thinking' && it.id === patch.id
    );
    if (existing) {
      if (patch.text !== undefined) existing.text = patch.text;
      if (patch.status !== undefined) existing.status = patch.status;
      if (patch.durationMs !== undefined) existing.durationMs = patch.durationMs;
    } else {
      this.activeTurn.push({
        kind: 'thinking',
        id: patch.id,
        status: patch.status ?? 'thinking',
        text: patch.text ?? '',
        startedAt: patch.startedAt ?? Date.now(),
        durationMs: patch.durationMs,
      } satisfies ChatThinking);
    }
  }

  /**
   * Freeze the active turn into committed history.
   * Marks all streaming messages as finalised (streaming: false).
   * Marks all still-thinking items as done, freezing their duration.
   * Should be called once the agent signals the turn is complete.
   */
  finalizeTurn(): void {
    if (!this.activeTurn) return;

    const finalized: ChatItem[] = this.activeTurn.map((item) => {
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

    this.committed = Object.freeze([...this.committed, ...finalized]);
    this.activeTurn = null;
  }

  /** Reset the store completely (e.g. when the conversation is closed). */
  reset(): void {
    this.committed = [];
    this.activeTurn = null;
  }
}
