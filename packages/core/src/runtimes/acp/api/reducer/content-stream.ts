import type { TranscriptTurn } from '../models/turns';
import { makeMessageId, makeThinkingId } from './ids';
import type { FoldEvent } from './item-fold';
import type { NormalizedEvent } from './normalized-event';

type ContentEvent = Extract<NormalizedEvent, { kind: 'message' | 'thinking' }>;
type ContentKind = 'user' | 'assistant' | 'thinking';

export interface SegmentState {
  open: { kind: ContentKind; providerId: string | null; itemId: string } | null;
  user: number;
  assistant: number;
  thinking: number;
}

export function initialSegment(): SegmentState {
  return { open: null, user: 0, assistant: 0, thinking: 0 };
}

/** The only mid-turn content finalization path. Async state folds never call it. */
export function closeContent(
  turn: TranscriptTurn,
  segment: SegmentState,
  at: number
): { turn: TranscriptTurn; segment: SegmentState } {
  if (!segment.open) return { turn, segment };
  const open = segment.open;
  const items =
    open.kind === 'thinking'
      ? turn.items.map((item) =>
          item.kind === 'thinking' && item.id === open.itemId && item.status === 'thinking'
            ? { ...item, status: 'done' as const, durationMs: at - item.startedAt }
            : item
        )
      : turn.items;
  return {
    turn: items === turn.items ? turn : { ...turn, items },
    segment: { ...segment, open: null },
  };
}

/**
 * Provider ids are opaque, exact identities, separate from generated ordinals.
 * A foreground transition ends a reasoning segment; subsequent reasoning gets
 * a new ordinal even if its provider id is reused. No identity is reconstructed
 * by inspecting strings or scanning finalized rows.
 */
export function materializeContent(
  turn: TranscriptTurn,
  segment: SegmentState,
  event: ContentEvent,
  at: number
): { turn: TranscriptTurn; segment: SegmentState; event: FoldEvent } {
  const kind = event.kind === 'thinking' ? 'thinking' : event.role;
  if (segment.open?.kind === kind && segment.open.providerId === event.messageId) {
    return { turn, segment, event: { ...event, itemId: segment.open.itemId } };
  }

  const closed = closeContent(turn, segment, at);
  const ordinal = closed.segment[kind];
  const itemId =
    kind === 'thinking'
      ? makeThinkingId(turn.id, event.messageId, ordinal)
      : makeMessageId(turn.id, event.messageId, kind, ordinal);
  return {
    turn: closed.turn,
    segment: {
      ...closed.segment,
      open: { kind, providerId: event.messageId, itemId },
      [kind]: ordinal + 1,
    },
    event: { ...event, itemId },
  };
}
