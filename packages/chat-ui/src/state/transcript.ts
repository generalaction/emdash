import { batch, createSignal } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type { ChatItem, TranscriptTurn } from '@/model';

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
  readonly activeTurn: readonly ChatItem[] | null;
  readonly committedTurns: readonly TranscriptTurn[];
  readonly activeTurnSnapshot: TranscriptTurn | null;
  readonly turnStatus: TurnStatus;
};

// ── ChatHistory ────────────────────────────────────────────────────────────────

export type ChatHistory = {
  /** All committed turns. Reactive: reading inside a memo/effect tracks identity changes. */
  get(): readonly TranscriptTurn[];
  /**
   * Replace the entire committed history and reset activeTurn.
   * Rebuilds the id map. Prefer for initial load / session replay.
   */
  seed(turns: readonly (TranscriptTurn | ChatItem)[]): void;
  /**
   * Prepend older items before the current committed history (pagination).
   * Stable object references required — identity-keyed caches key by ref.
   * Rebuilds the id map (O(total)).
   */
  prepend(turns: readonly (TranscriptTurn | ChatItem)[]): void;
  /**
   * Append items after the current committed history (commit path / bulk add).
   * Patches the id map incrementally (O(new)).
   */
  append(turns: readonly (TranscriptTurn | ChatItem)[]): void;
};

// ── ActiveTurn ─────────────────────────────────────────────────────────────────

export type ActiveTurn = {
  /**
   * The current desired snapshot — the full intended turn state, including any
   * text that may still be buffered in an overlying smoother. Callers that want
   * to extend the turn (e.g. via applyTurnEvent) should read from here, not from
   * state.activeTurn (which may hold a partial/delivered view).
   */
  get(): any;
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
  set(turn: TranscriptTurn | readonly ChatItem[] | null, _status?: TurnStatus): void;
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
  return committedItems(state).length + (state.activeTurn?.length ?? 0);
}

/** Get item at absolute index (committed first, then activeTurn). */
export function getItem(state: TranscriptState, i: number): ChatItem | undefined {
  const committed = committedItems(state);
  const cl = committed.length;
  if (i < cl) return committed[i];
  return state.activeTurn?.[i - cl];
}

/**
 * Returns the absolute indices of all user-role message items in the committed
 * tier, in ascending order.
 */
export function collectUserTurnIndices(state: TranscriptState): number[] {
  const result: number[] = [];
  const items = committedItems(state);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'message' && item.role === 'user') {
      result.push(i);
    }
  }
  return result;
}

/** All items as a readonly array (allocates — use getItem for reactive per-index access). */
export function allItems(state: TranscriptState): readonly ChatItem[] {
  const committed = committedItems(state);
  if (!state.activeTurn || state.activeTurn.length === 0) return committed;
  return [...committed, ...state.activeTurn];
}

export function committedItems(state: TranscriptState): readonly ChatItem[] {
  return turnsToItems(state.committedTurns);
}

export function turnsToItems(turns: readonly TranscriptTurn[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const turn of turns) {
    items.push(...orderedItems(turn.items));
  }
  return items;
}

export function orderedTurns(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  return [...turns].sort((a, b) => a.seq - b.seq);
}

export function orderedItems(items: readonly ChatItem[]): ChatItem[] {
  return [...items].sort((a, b) => ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0));
}

function itemsToTurn(items: readonly ChatItem[], status?: 'done' | 'cancelled'): TranscriptTurn {
  return {
    id: `compat-turn:${items[0]?.id ?? 'empty'}`,
    seq: Number.MAX_SAFE_INTEGER,
    initiator: items.some((item) => item.kind === 'message' && item.role === 'user')
      ? 'user'
      : 'agent',
    items: items as TranscriptTurn['items'],
    outcome: status ? { kind: status } : undefined,
  };
}

function normalizeTurns(input: readonly (TranscriptTurn | ChatItem)[]): TranscriptTurn[] {
  if (input.every((item) => 'items' in item)) return orderedTurns(input as readonly TranscriptTurn[]);
  return [itemsToTurn(input as readonly ChatItem[])];
}

function finalizeCompatItem(item: ChatItem): ChatItem {
  if (item.kind === 'message') return { ...item, streaming: false } as ChatItem;
  if ('status' in item && item.status === 'running') return { ...item, status: 'done' } as ChatItem;
  if (item.kind === 'plan') return { ...item, streaming: false } as ChatItem;
  return item;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTranscript(): TranscriptApi {
  // Committed items are immutable after placement — only ever swapped as a whole
  // array identity (seed/prepend/append). A plain signal gives coarse tracking
  // with zero store-proxy overhead on the hot measure/render path.
  const [committed, setCommitted] = createSignal<readonly TranscriptTurn[]>([]);

  // activeTurn + turnStatus mutate in place during streaming; fine-grained
  // store tracking is warranted here.
  const [live, setLive] = createStore<{ activeTurn: TranscriptTurn | null; turnStatus: TurnStatus }>({
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
      return turnsToItems(committed());
    },
    get activeTurn() {
      return live.activeTurn?.items ?? null;
    },
    get committedTurns() {
      return committed();
    },
    get activeTurnSnapshot() {
      return live.activeTurn;
    },
    get turnStatus() {
      return live.turnStatus;
    },
  };

  // item id → committed item index map; rebuilt on history mutations.
  const idMap = new Map<string, number>();

  const rebuildIdMap = (turns: readonly TranscriptTurn[]): void => {
    idMap.clear();
    const items = turnsToItems(turns);
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

  // ── history ─────────────────────────────────────────────────────────────────

  const history: ChatHistory = {
    get() {
      return committed();
    },

    seed(turns) {
      const ordered = normalizeTurns(turns);
      batch(() => {
        setCommitted(ordered);
        setLive({ activeTurn: null, turnStatus: 'done' });
      });
      rebuildIdMap(ordered);
    },

    prepend(turns) {
      if (turns.length === 0) return;
      setCommitted((prev) => orderedTurns([...normalizeTurns(turns), ...prev]));
      rebuildIdMap(committed());
    },

    append(turns) {
      if (turns.length === 0) return;
      setCommitted((prev) => orderedTurns([...prev, ...normalizeTurns(turns)]));
      rebuildIdMap(committed());
    },
  };

  // ── activeTurn ──────────────────────────────────────────────────────────────

  const activeTurnApi: ActiveTurn = {
    get() {
      return live.activeTurn?.items ?? null;
    },

    status() {
      return live.activeTurn ? 'generating' : 'done';
    },

    set(turn, status) {
      batch(() => {
        if (turn === null) {
          setLive({ activeTurn: null, turnStatus: 'done' });
        } else {
          const nextTurn = Array.isArray(turn)
            ? itemsToTurn(turn as readonly ChatItem[], status as 'done' | 'cancelled')
            : (turn as TranscriptTurn);
          setLive('turnStatus', status ?? 'generating');
          setLive('activeTurn', reconcile(nextTurn, { key: 'id' }));
        }
      });
    },

    commit(status = 'done') {
      const raw = live.activeTurn;
      if (!raw) return;
      const turn = {
        ...(unwrap(raw) as TranscriptTurn),
        items: (unwrap(raw).items as ChatItem[]).map((item) => finalizeCompatItem(item)) as TranscriptTurn['items'],
        outcome: { kind: status },
      } satisfies TranscriptTurn;
      batch(() => {
        history.append([turn]);
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
        const offset = turnsToItems(committed()).length;
        for (let i = 0; i < at.items.length; i++) {
          if (at.items[i].id === id) return offset + i;
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
