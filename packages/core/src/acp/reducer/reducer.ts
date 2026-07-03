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
import type { SessionCommand, SessionConfigState, SessionUsage } from '../models/session';
import { emptyConfig } from '../models/session';
import type {
  TranscriptItem,
  TranscriptMessage,
  TranscriptState,
  TranscriptThinking,
  TranscriptTurn,
} from '../models/transcript';
import { deriveConfigGroups } from './config-derive';
import { decodeSessionUpdate } from './decode';
import { makeMessageId, makeThinkingId, makeTurnId } from './ids';
import { foldItem, finalizeItems, type FoldEvent } from './item-fold';
import type { EnrichHook, NormalizedEvent } from './normalized-event';

type SynthesizedSegmentKind = 'message:user' | 'message:assistant' | 'thinking';

export interface SegmentState {
  open: SynthesizedSegmentKind | null;
  user: number;
  assistant: number;
  thinking: number;
}

export interface ParserState {
  transcript: TranscriptState;
  config: SessionConfigState;
  usage: SessionUsage | null;
  title: string | null;
  pendingModeId: string | null;
  segment: SegmentState;
}

export type ReducerInput =
  | { kind: 'update'; update: SessionUpdate; at: number }
  | { kind: 'event'; event: NormalizedEvent; at: number }
  | { kind: 'close'; at: number };

export interface ReducerDeps {
  conversationId: string;
  enrich?: EnrichHook;
}

export function initialState(): ParserState {
  return {
    transcript: { committed: [], active: null },
    config: emptyConfig(),
    usage: null,
    title: null,
    pendingModeId: null,
    segment: initialSegment(),
  };
}

function initialSegment(): SegmentState {
  return {
    open: null,
    user: 0,
    assistant: 0,
    thinking: 0,
  };
}

function nextTurnIndex(t: TranscriptState): number {
  return t.committed.length + (t.active ? 1 : 0);
}

function openTurn(t: TranscriptState, deps: ReducerDeps): TranscriptState {
  const id = makeTurnId(deps.conversationId, nextTurnIndex(t));
  const turn: TranscriptTurn = { id, items: [] };
  return { ...t, active: turn };
}

/**
 * Finalize and commit the active turn to history.
 * No-op when there is no active turn.
 */
export function closeActive(t: TranscriptState, at: number): TranscriptState {
  if (!t.active) return t;
  const committed: TranscriptTurn = {
    ...t.active,
    items: finalizeItems(t.active.items, at),
  };
  return { committed: [...t.committed, committed], active: null };
}

/**
 * Returns true when the incoming user message represents a NEW turn open.
 * Uses the CURRENT active turn's id — not a tentative next-turn id — so the
 * lookup matches the items already stored in the turn.
 */
export function isNewUserMessage(
  active: TranscriptTurn | null,
  event: Extract<NormalizedEvent, { kind: 'message' }>,
  segment: SegmentState
): boolean {
  if (!active) return true;
  if (event.messageId === null) {
    if (segment.open === 'message:user') return false;
    return active.items.some((it) => it.kind !== 'message' || it.role !== 'user');
  }
  const id = makeMessageId(active.id, event.messageId, 'user');
  return !active.items.some((it) => it.kind === 'message' && it.id === id);
}

function segmentStream(kind: SynthesizedSegmentKind): keyof Omit<SegmentState, 'open'> {
  switch (kind) {
    case 'message:user':
      return 'user';
    case 'message:assistant':
      return 'assistant';
    case 'thinking':
      return 'thinking';
  }
}

function segmentKind(
  event: Extract<NormalizedEvent, { kind: 'message' | 'thinking' }>
): SynthesizedSegmentKind {
  if (event.kind === 'thinking') return 'thinking';
  return event.role === 'user' ? 'message:user' : 'message:assistant';
}

function synthesizedMessageId(segment: SegmentState, kind: SynthesizedSegmentKind): string {
  const stream = segmentStream(kind);
  return `auto:${stream}:${segment[stream]}`;
}

function closeSynthesizedSegment(
  transcript: TranscriptState,
  segment: SegmentState,
  at: number
): { transcript: TranscriptState; segment: SegmentState } {
  const active = transcript.active;
  if (!active || !segment.open) return { transcript, segment };

  const openKind = segment.open;
  const stream = segmentStream(openKind);
  const messageId = synthesizedMessageId(segment, openKind);
  const itemId =
    openKind === 'thinking'
      ? makeThinkingId(active.id, messageId)
      : makeMessageId(active.id, messageId, stream);
  let changed = false;
  const items = active.items.map((item): TranscriptItem => {
    if (openKind === 'thinking') {
      if (item.kind === 'thinking' && item.id === itemId && item.status === 'thinking') {
        changed = true;
        return { ...item, status: 'done' as const, durationMs: at - item.startedAt };
      }
      return item;
    }
    if (item.kind === 'message' && item.id === itemId && item.streaming) {
      changed = true;
      return { ...item, streaming: false } satisfies TranscriptMessage;
    }
    return item;
  });

  const nextSegment: SegmentState = {
    ...segment,
    open: null,
    [stream]: segment[stream] + 1,
  };

  if (!changed) return { transcript, segment: nextSegment };
  return { transcript: { ...transcript, active: { ...active, items } }, segment: nextSegment };
}

function resolveProviderThinkingMessageId(active: TranscriptTurn, messageId: string): string {
  for (let i = active.items.length - 1; i >= 0; i -= 1) {
    const item = active.items[i];
    if (
      item.kind === 'thinking' &&
      item.status === 'thinking' &&
      (item.messageId === messageId || item.messageId.startsWith(`${messageId}:segment:`))
    ) {
      return item.messageId;
    }
  }

  const baseId = makeThinkingId(active.id, messageId);
  const base = active.items.find(
    (item): item is TranscriptThinking => item.kind === 'thinking' && item.id === baseId
  );
  if (!base || base.status !== 'done') return messageId;

  const prefix = `${messageId}:segment:`;
  const count = active.items.filter(
    (item) => item.kind === 'thinking' && item.messageId.startsWith(prefix)
  ).length;
  return `${prefix}${count + 1}`;
}

function materializeEvent(
  transcript: TranscriptState,
  segment: SegmentState,
  event: NormalizedEvent,
  at: number
): { transcript: TranscriptState; segment: SegmentState; event: FoldEvent } {
  if (event.kind === 'message' || event.kind === 'thinking') {
    if (event.messageId === null) {
      const kind = segmentKind(event);
      const closed =
        segment.open === kind
          ? { transcript, segment }
          : closeSynthesizedSegment(transcript, segment, at);
      const messageId = synthesizedMessageId(closed.segment, kind);
      const nextSegment = { ...closed.segment, open: kind };
      return {
        transcript: closed.transcript,
        segment: nextSegment,
        event: { ...event, messageId },
      };
    }

    const closed = closeSynthesizedSegment(transcript, segment, at);
    if (event.kind === 'thinking' && closed.transcript.active) {
      return {
        ...closed,
        event: {
          ...event,
          messageId: resolveProviderThinkingMessageId(closed.transcript.active, event.messageId),
        },
      };
    }
    return { ...closed, event: event as FoldEvent };
  }

  const closed = closeSynthesizedSegment(transcript, segment, at);
  return { ...closed, event: event as FoldEvent };
}

/**
 * Pure reducer: (ParserState, ReducerInput, ReducerDeps) → ParserState.
 * All state changes return a new ParserState; no mutation occurs.
 */
export function reduce(s: ParserState, input: ReducerInput, deps: ReducerDeps): ParserState {
  if (input.kind === 'close') {
    const transcript = closeActive(s.transcript, input.at);
    return transcript === s.transcript
      ? { ...s, segment: initialSegment() }
      : { ...s, transcript, segment: initialSegment() };
  }

  const event =
    input.kind === 'event'
      ? input.event
      : deps.enrich
        ? deps.enrich(decodeSessionUpdate(input.update), input.update)
        : decodeSessionUpdate(input.update);

  switch (event.kind) {
    case 'config': {
      const groups = deriveConfigGroups(event.options);
      const config: SessionConfigState = { ...s.config, ...groups };
      if (s.pendingModeId && config.modeOptions) {
        config.modeOptions = { ...config.modeOptions, selected: s.pendingModeId };
      }
      return {
        ...s,
        config,
        pendingModeId: config.modeOptions ? null : s.pendingModeId,
      };
    }
    case 'mode_selected': {
      if (!s.config.modeOptions) return { ...s, pendingModeId: event.modeId };
      const config: SessionConfigState = {
        ...s.config,
        modeOptions: { ...s.config.modeOptions, selected: event.modeId },
      };
      return { ...s, config, pendingModeId: null };
    }
    case 'commands': {
      const availableCommands = event.commands.map((c) => {
        const raw = c as unknown as {
          name: string;
          description: string;
          input?: { hint?: string };
        };
        const cmd: SessionCommand = {
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
  let segment = s.segment;

  // OPEN boundary: a new user message starts a new turn.
  if (event.kind === 'message' && event.role === 'user') {
    if (isNewUserMessage(t.active, event, segment)) {
      t = closeActive(t, input.at);
      t = openTurn(t, deps);
      segment = initialSegment();
    }
  }

  // Lazy open: agent-initiated content with no active turn.
  if (!t.active) {
    t = openTurn(t, deps);
    segment = initialSegment();
  }

  const materialized = materializeEvent(t, segment, event, input.at);
  t = materialized.transcript;
  segment = materialized.segment;

  const active = t.active!;
  const items = foldItem(active.items, materialized.event, active.id, input.at);

  if (items === active.items && t === s.transcript && segment === s.segment) return s;
  const transcript: TranscriptState =
    items === active.items ? t : { ...t, active: { ...active, items } };
  return { ...s, transcript, segment };
}
