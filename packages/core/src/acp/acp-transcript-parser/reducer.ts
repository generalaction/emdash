/**
 * Pure transcript state reducer.
 *
 * Manages turn boundaries and delegates per-event item updates to foldItem.
 * The two inputs (update / close) drive the two close semantics:
 *
 *   update:  a raw SessionUpdate. The transform is applied to get a
 *            NormalizedEvent. A new user message opens a new turn (closing
 *            the previous one implicitly). Agent-initiated content opens a
 *            turn lazily. Ignored events are no-ops.
 *
 *   close:   explicit turn-end signal. In live mode the runtime calls this
 *            when prompt() resolves. In replay mode AcpTranscriptParser.replay()
 *            calls it once at EOF to close the trailing turn.
 *
 * Turn boundary rules:
 *   OPEN (implicit):  a new user message (new item id) → close active + open.
 *   OPEN (lazy):      agent content with no active turn → open.
 *   CLOSE (explicit): 'close' input → closeActive.
 *   CLOSE (implicit): next new user message while a turn is active → closeActive + open.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ProviderTransform } from './normalized-event';
import type { TranscriptState, TranscriptTurn } from './model';
import { foldItem, finalizeItems } from './item-fold';
import { makeMessageId, makeTurnId } from './ids';

// ── Reducer input ───────────────────────────────────────────────────────────

export type ReducerInput =
  | { kind: 'update'; update: SessionUpdate }
  | { kind: 'close' };

// ── Reducer deps ────────────────────────────────────────────────────────────

export interface ReducerDeps {
  conversationId: string;
  transform: ProviderTransform;
  /** 'live' for interactive sessions; 'replay' for loadSession replay. */
  source: 'live' | 'replay';
}

// ── Initial state ───────────────────────────────────────────────────────────

export function initialState(): TranscriptState {
  return { committed: [], active: null };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextTurnIndex(s: TranscriptState): number {
  return s.committed.length + (s.active ? 1 : 0);
}

/** Open a new active turn. Does NOT close any existing active turn — caller must do that. */
function openTurn(s: TranscriptState, deps: ReducerDeps): TranscriptState {
  const id = makeTurnId(deps.conversationId, nextTurnIndex(s));
  const turn: TranscriptTurn = { id, source: deps.source, items: [] };
  return { ...s, active: turn };
}

/**
 * Finalize and commit the active turn to history.
 * No-op when there is no active turn.
 */
export function closeActive(s: TranscriptState): TranscriptState {
  if (!s.active) return s;
  const committed: TranscriptTurn = {
    ...s.active,
    items: finalizeItems(s.active.items),
  };
  return { committed: [...s.committed, committed], active: null };
}

/**
 * Returns true when the incoming user message represents a NEW turn open.
 * A message is "new" if the active turn does not already contain a message
 * item with the same id (i.e. we haven't seen this messageId before).
 *
 * Uses the CURRENT active turn's id for id synthesis — not a tentative
 * next-turn id — so the lookup matches the items already stored in the turn.
 */
export function isNewUserMessage(active: TranscriptTurn | null, messageId: string | null): boolean {
  if (!active) return true;
  const id = makeMessageId(active.id, messageId, 'user');
  return !active.items.some((it) => it.kind === 'message' && it.id === id);
}

// ── reduce ──────────────────────────────────────────────────────────────────

/**
 * Pure reducer: (TranscriptState, ReducerInput, ReducerDeps) → TranscriptState.
 *
 * All state changes return a new TranscriptState; no mutation occurs.
 */
export function reduce(s: TranscriptState, input: ReducerInput, deps: ReducerDeps): TranscriptState {
  if (input.kind === 'close') {
    return closeActive(s);
  }

  const event = deps.transform(input.update);
  if (event.kind === 'ignored') return s;

  // OPEN boundary: a new user message starts a new turn.
  if (event.kind === 'message' && event.role === 'user') {
    // isNewUserMessage checks the CURRENT active turn's id — it must match the
    // ids already stored in the turn's items, not the tentative next-turn id.
    if (isNewUserMessage(s.active, event.messageId)) {
      // Close the previous turn, then open a fresh one.
      s = closeActive(s);
      s = openTurn(s, deps);
    }
  }

  // Lazy open: agent-initiated content with no active turn.
  if (!s.active) {
    s = openTurn(s, deps);
  }

  const active = s.active!;
  const items = foldItem(active.items, event, active.id);

  if (items === active.items) return s; // no change (ignored / no-op fold)
  return { ...s, active: { ...active, items } };
}
