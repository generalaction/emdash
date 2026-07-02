/**
 * Solid transcript store — hybrid two-tier API.
 *
 * Two-tier model:
 *   history     — committed items in a plain createSignal (no proxy overhead).
 *                 Mutated only by seed/prepend/append (coarse-identity tracking).
 *   activeTurn  — in-progress streaming items in a fine-grained createStore.
 *                 activeTurn.set uses reconcile(key:'id') for in-place text growth.
 *
 * The public write surface is split into two namespaces:
 *
 *   history.seed(items)    — replace everything (session replay / initial load)
 *   history.prepend(items) — insert older items before committed (pagination)
 *   history.append(items)  — append items after committed (commit path)
 *
 *   activeTurn.set(items, status) — controlled: host pushes a full snapshot;
 *                                   reconcile diffs it in place, so text growth
 *                                   only patches the changed message node.
 *   activeTurn.commit(status)     — finalize turn → history.append → clear
 *
 * Pure helpers for building snapshots live in turn-reducer.ts:
 *   applyTurnEvent(turn, event) → new ChatItem[]
 *   finalizeTurn(turn)          → new ChatItem[]  (also called internally by commit)
 */

import { batch, createSignal } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type { ChatItem } from '@/model';
import { finalizeTurn } from './turn-reducer';

/**
 * Global turn lifecycle status.
 *
 * - `'generating'` — the agent is actively streaming content.
 * - `'cancelled'`  — the host called commit('cancelled'); stays until next turn.
 * - `'done'`       — the turn completed normally, or no turn has run yet.
 */
export type TurnStatus = 'generating' | 'cancelled' | 'done';

export type TranscriptState = {
  readonly committed: readonly ChatItem[];
  readonly activeTurn: ChatItem[] | null;
  readonly turnStatus: TurnStatus;
};

// ── ChatHistory ────────────────────────────────────────────────────────────────

export type ChatHistory = {
  /** All committed items. Reactive: reading inside a memo/effect tracks identity changes. */
  get(): readonly ChatItem[];
  /**
   * Replace the entire committed history and reset activeTurn.
   * Rebuilds the id map. Prefer for initial load / session replay.
   */
  seed(items: readonly ChatItem[]): void;
  /**
   * Prepend older items before the current committed history (pagination).
   * Stable object references required — identity-keyed caches key by ref.
   * Rebuilds the id map (O(total)).
   */
  prepend(items: readonly ChatItem[]): void;
  /**
   * Append items after the current committed history (commit path / bulk add).
   * Patches the id map incrementally (O(new)).
   */
  append(items: readonly ChatItem[]): void;
};

// ── ActiveTurn ─────────────────────────────────────────────────────────────────

export type ActiveTurn = {
  /**
   * The current desired snapshot — the full intended turn state, including any
   * text that may still be buffered in an overlying smoother. Callers that want
   * to extend the turn (e.g. via applyTurnEvent) should read from here, not from
   * state.activeTurn (which may hold a partial/delivered view).
   */
  get(): readonly ChatItem[] | null;
  /** The current turn lifecycle status. */
  status(): TurnStatus;
  /**
   * Replace the active turn with a full snapshot and set the status.
   *
   * Uses reconcile(key:'id') so in-place text growth only patches the changed
   * message node (O(activeTurn), not O(total)).
   *
   * - Pass `null` to clear the turn (e.g. after commit).
   * - Stable item `id` fields are required for reconcile to work correctly.
   * - The host is authoritative; chat-ui does not assume it is the sole writer.
   */
  set(items: readonly ChatItem[] | null, status: TurnStatus): void;
  /**
   * Finalize the active turn, move it to history, and clear.
   *
   * Internally calls finalizeTurn → history.append → set(null, status).
   * Batched so all three signal writes happen in a single reactive flush.
   *
   * @param status - 'done' (default) or 'cancelled'
   */
  commit(status?: 'done' | 'cancelled'): void;
};

// ── TranscriptApi ──────────────────────────────────────────────────────────────

export type TranscriptApi = {
  /** Imperative history write surface (seed / prepend / append). */
  history: ChatHistory;
  /** Controlled active-turn write surface (set / commit). */
  activeTurn: ActiveTurn;
  /** Reactive read facade — consumed by ChatRoot and helpers. */
  readonly state: TranscriptState;
  /**
   * Returns the absolute index (committed-first) of the item with the given id,
   * or -1 if not found.
   */
  findIndexById(id: string): number;
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

/**
 * Returns the absolute indices of all user-role message items in the committed
 * tier, in ascending order.
 */
export function collectUserTurnIndices(state: TranscriptState): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.committed.length; i++) {
    const item = state.committed[i];
    if (item.kind === 'message' && item.role === 'user') {
      result.push(i);
    }
  }
  return result;
}

/** All items as a readonly array (allocates — use getItem for reactive per-index access). */
export function allItems(state: TranscriptState): readonly ChatItem[] {
  if (!state.activeTurn || state.activeTurn.length === 0) return state.committed;
  return [...state.committed, ...state.activeTurn];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTranscript(): TranscriptApi {
  // Committed items are immutable after placement — only ever swapped as a whole
  // array identity (seed/prepend/append). A plain signal gives coarse tracking
  // with zero store-proxy overhead on the hot measure/render path.
  const [committed, setCommitted] = createSignal<readonly ChatItem[]>([]);

  // activeTurn + turnStatus mutate in place during streaming; fine-grained
  // store tracking is warranted here.
  const [live, setLive] = createStore<{ activeTurn: ChatItem[] | null; turnStatus: TurnStatus }>({
    activeTurn: null,
    turnStatus: 'done',
  });

  // Expose the TranscriptState shape via getters so existing reactive readers
  // keep working. Tracking semantics are preserved: committed() is read in the
  // getter so createMemo/createEffect that access state.committed will re-run
  // on identity changes. live.activeTurn/live.turnStatus retain fine-grained
  // reactivity.
  const state: TranscriptState = {
    get committed() {
      return committed();
    },
    get activeTurn() {
      return live.activeTurn;
    },
    get turnStatus() {
      return live.turnStatus;
    },
  };

  // id → committed index map; rebuilt on seed/prepend, patched incrementally on append.
  const idMap = new Map<string, number>();

  const rebuildIdMap = (items: readonly ChatItem[]): void => {
    idMap.clear();
    for (let i = 0; i < items.length; i++) {
      if (import.meta.env.DEV && idMap.has(items[i].id)) {
        console.error(
          `[chat-ui] duplicate ChatItem id "${items[i].id}" at index ${i} — ` +
            'item ids must be unique across the entire transcript. ' +
            'This will corrupt id-keyed lookups (heightmap, scroll anchor, reconcile).'
        );
      }
      idMap.set(items[i].id, i);
    }
  };

  const patchIdMap = (items: readonly ChatItem[], offset: number): void => {
    for (let i = 0; i < items.length; i++) {
      if (import.meta.env.DEV && idMap.has(items[i].id)) {
        console.error(
          `[chat-ui] duplicate ChatItem id "${items[i].id}" at append offset ${offset + i} — ` +
            'item ids must be unique across the entire transcript. ' +
            'This will corrupt id-keyed lookups (heightmap, scroll anchor, reconcile).'
        );
      }
      idMap.set(items[i].id, offset + i);
    }
  };

  // ── history ─────────────────────────────────────────────────────────────────

  const history: ChatHistory = {
    get() {
      return committed();
    },

    seed(items) {
      batch(() => {
        setCommitted([...items]);
        setLive({ activeTurn: null, turnStatus: 'done' });
      });
      rebuildIdMap(items);
    },

    prepend(items) {
      if (items.length === 0) return;
      setCommitted((prev) => [...items, ...prev]);
      rebuildIdMap(committed());
    },

    append(items) {
      if (items.length === 0) return;
      const offset = committed().length;
      setCommitted((prev) => [...prev, ...items]);
      patchIdMap(items, offset);
    },
  };

  // ── activeTurn ──────────────────────────────────────────────────────────────

  const activeTurnApi: ActiveTurn = {
    get() {
      return live.activeTurn;
    },

    status() {
      return live.turnStatus;
    },

    set(items, status) {
      batch(() => {
        setLive('turnStatus', status);
        if (items === null) {
          setLive('activeTurn', null);
        } else {
          // reconcile(key:'id') diffs the new snapshot against the current store
          // value: items with unchanged id+fields are left alone; changed fields
          // (e.g. growing text) are patched in place.  Cost: O(activeTurn).
          setLive('activeTurn', reconcile(items as ChatItem[], { key: 'id' }));
        }
      });
    },

    commit(status = 'done') {
      // Unwrap store proxies → plain objects before finalizeTurn spreads them.
      const raw: ChatItem[] = unwrap(live.activeTurn) ?? [];
      const finalized = finalizeTurn(raw);
      batch(() => {
        history.append(finalized);
        setLive({ activeTurn: null, turnStatus: status });
      });
    },
  };

  return {
    history,
    activeTurn: activeTurnApi,
    state,

    findIndexById(id) {
      const ci = idMap.get(id);
      if (ci !== undefined) return ci;
      const at = live.activeTurn;
      if (at) {
        const offset = committed().length;
        for (let i = 0; i < at.length; i++) {
          if (at[i].id === id) return offset + i;
        }
      }
      return -1;
    },

    reset() {
      batch(() => {
        setCommitted([]);
        setLive({ activeTurn: null, turnStatus: 'done' });
      });
      idMap.clear();
    },
  };
}
