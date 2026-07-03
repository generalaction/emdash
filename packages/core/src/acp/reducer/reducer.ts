/**
 * Pure parser state reducer.
 *
 * State is now composite — it holds the transcript slice (committed turns +
 * active turn) and the session slices (config, usage, title) side by side.
 * A single reduce() call routes each NormalizedEvent to the appropriate slice:
 *
 *   transcript kinds (message / thinking / tool_call / tool_update / plan)
 *     → turn boundary logic + item fold (unchanged from before).
 *
 *   session kinds (config / mode_selected / commands / usage / title)
 *     → slice update, no turn boundary side-effect.
 *
 *   ignored → no-op on all slices.
 *
 *   close → finalize + commit the active transcript turn.
 *
 * Turn boundary rules (transcript only):
 *   OPEN (implicit):  a new user message (new item id) → close active + open.
 *   OPEN (lazy):      agent content with no active turn → open.
 *   CLOSE (explicit): 'close' input → closeActive.
 *   CLOSE (implicit): next new user message while a turn is active → closeActive + open.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ProviderTransform } from './normalized-event';
import type { TranscriptState, TranscriptTurn } from '../models/transcript';
import type { SessionConfigState, SessionUsage } from '../models/session';
import { foldItem, finalizeItems } from './item-fold';
import { makeMessageId, makeTurnId } from './ids';
import { deriveConfigGroups } from './config-derive';
import { emptyConfig } from '../models/session';

export interface ParserState {
  transcript: TranscriptState;
  config: SessionConfigState;
  usage: SessionUsage | null;
  title: string | null;
}

export type ReducerInput =
  | { kind: 'update'; update: SessionUpdate }
  | { kind: 'close' };

export interface ReducerDeps {
  conversationId: string;
  transform: ProviderTransform;
  /** 'live' for interactive sessions; 'replay' for loadSession replay. */
  source: 'live' | 'replay';
}

export function initialState(): ParserState {
  return {
    transcript: { committed: [], active: null },
    config: emptyConfig(),
    usage: null,
    title: null,
  };
}

function nextTurnIndex(t: TranscriptState): number {
  return t.committed.length + (t.active ? 1 : 0);
}

function openTurn(t: TranscriptState, deps: ReducerDeps): TranscriptState {
  const id = makeTurnId(deps.conversationId, nextTurnIndex(t));
  const turn: TranscriptTurn = { id, source: deps.source, items: [] };
  return { ...t, active: turn };
}

/**
 * Finalize and commit the active turn to history.
 * No-op when there is no active turn.
 */
export function closeActive(t: TranscriptState): TranscriptState {
  if (!t.active) return t;
  const committed: TranscriptTurn = {
    ...t.active,
    items: finalizeItems(t.active.items),
  };
  return { committed: [...t.committed, committed], active: null };
}

/**
 * Returns true when the incoming user message represents a NEW turn open.
 * Uses the CURRENT active turn's id — not a tentative next-turn id — so the
 * lookup matches the items already stored in the turn.
 */
export function isNewUserMessage(active: TranscriptTurn | null, messageId: string | null): boolean {
  if (!active) return true;
  const id = makeMessageId(active.id, messageId, 'user');
  return !active.items.some((it) => it.kind === 'message' && it.id === id);
}

/**
 * Pure reducer: (ParserState, ReducerInput, ReducerDeps) → ParserState.
 * All state changes return a new ParserState; no mutation occurs.
 */
export function reduce(s: ParserState, input: ReducerInput, deps: ReducerDeps): ParserState {
  if (input.kind === 'close') {
    const transcript = closeActive(s.transcript);
    return transcript === s.transcript ? s : { ...s, transcript };
  }

  const event = deps.transform(input.update);

  switch (event.kind) {
    case 'config': {
      const groups = deriveConfigGroups(event.options);
      const config: SessionConfigState = { ...s.config, ...groups };
      return { ...s, config };
    }
    case 'mode_selected': {
      if (!s.config.modeOptions) return s;
      const config: SessionConfigState = {
        ...s.config,
        modeOptions: { ...s.config.modeOptions, selected: event.modeId },
      };
      return { ...s, config };
    }
    case 'commands': {
      const availableCommands = event.commands.map((c) => {
        const raw = c as unknown as { name: string; description: string; input?: { hint?: string } };
        const cmd: import('../models/session').SessionCommand = {
          name: raw.name,
          description: raw.description,
        };
        if (raw.input?.hint) cmd.inputHint = raw.input.hint;
        return cmd;
      });
      return { ...s, config: { ...s.config, availableCommands } };
    }
    case 'usage':
      return { ...s, usage: event.usage };
    case 'title':
      return { ...s, title: event.title };
    case 'ignored':
      return s;
    default:
      break; // falls through to transcript handling below
  }

  let t = s.transcript;

  // OPEN boundary: a new user message starts a new turn.
  if (event.kind === 'message' && event.role === 'user') {
    if (isNewUserMessage(t.active, event.messageId)) {
      t = closeActive(t);
      t = openTurn(t, deps);
    }
  }

  // Lazy open: agent-initiated content with no active turn.
  if (!t.active) {
    t = openTurn(t, deps);
  }

  const active = t.active!;
  const items = foldItem(active.items, event, active.id);

  if (items === active.items && t === s.transcript) return s;
  const transcript: TranscriptState =
    items === active.items ? t : { ...t, active: { ...active, items } };
  return { ...s, transcript };
}
