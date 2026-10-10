import { describe, expect, it } from 'vitest';
import { transcriptTurnSchema } from '../models/turns/turn';
import type { NormalizedEvent } from './normalized-event';
import { AcpTranscriptParser } from './parser';

const notice: NormalizedEvent = {
  kind: 'notification',
  title: 'Monitor expired',
  text: '12 events delivered.',
};
const message = (
  role: 'user' | 'assistant',
  text: string,
  messageId: string | null = null
): NormalizedEvent => ({ kind: 'message', role, text, messageId });
const parser = () => new AcpTranscriptParser({ conversationId: 'notices' });

describe('passive transcript notifications', () => {
  it('records an idle first notice without a user, outcome, or active turn', () => {
    const p = parser();
    expect(p.advancesForeground(notice)).toBe(false);
    p.pushEvent(notice, 0);
    expect(p.activeTurn).toBeNull();
    expect(p.history).toHaveLength(1);
    expect(p.history[0]).toMatchObject({
      initiator: 'agent',
      seq: 0,
      items: [{ ...notice, seq: 0 }],
    });
    expect(p.history[0].outcome).toBeUndefined();
    expect(p.agents).toEqual([]);
    expect(p.historyRevision).toBe(1);
    expect(transcriptTurnSchema.parse(JSON.parse(JSON.stringify(p.history[0])))).toEqual(
      p.history[0]
    );
  });

  it.each(['done', 'cancelled', 'error', 'interrupted'] as const)(
    'amends history without reopening or changing a %s outcome',
    (kind) => {
      const p = parser();
      p.pushEvent(message('user', 'First'), 0);
      p.settleTurn({ kind }, 1);
      const oldTurn = p.history[0];
      p.pushEvent(notice, 2);
      expect(p.activeTurn).toBeNull();
      expect(p.history).toHaveLength(1);
      expect(p.history[0].id).toBe(oldTurn.id);
      expect(p.history[0].outcome).toEqual({ kind });
      expect(oldTurn.items).toHaveLength(1);
      expect(p.history[0].items).toHaveLength(2);
      expect(p.historyRevision).toBe(2);
      p.pushEvent(message('user', 'Next'), 3);
      expect(p.activeTurn).toMatchObject({ seq: 1, initiator: 'user' });
      expect(p.activeTurn?.id).not.toBe(oldTurn.id);
    }
  );

  it.each(['user', 'assistant', 'thinking'] as const)(
    'preserves %s content continuity at every delta boundary',
    (kind) => {
      const source = 'Content <xml> & **markdown** stays together.';
      for (const messageId of [null, 'provider-message']) {
        for (let split = 1; split < source.length; split++) {
          const p = parser();
          const content = (text: string): NormalizedEvent =>
            kind === 'thinking' ? { kind, text, messageId } : message(kind, text, messageId);
          p.pushEvent(content(source.slice(0, split)), 100);
          const turnId = p.activeTurn?.id;
          const itemId = p.activeTurn?.items[0].id;
          p.pushEvent(notice, 200);
          p.pushEvent(content(source.slice(split)), 300);
          expect(p.history).toEqual([]);
          expect(p.historyRevision).toBe(0);
          expect(p.activeTurn?.id).toBe(turnId);
          expect(p.activeTurn?.items).toHaveLength(2);
          expect(p.activeTurn?.items[0]).toMatchObject({ id: itemId, text: source });
          if (kind === 'thinking')
            expect(p.activeTurn?.items[0]).toMatchObject({ status: 'thinking', startedAt: 100 });
          p.endTurn(400);
          expect(p.history[0].items[1]).toMatchObject(notice);
          if (kind === 'thinking')
            expect(p.history[0].items[0]).toMatchObject({ status: 'done', durationMs: 300 });
        }
      }
    }
  );

  it('keeps repeated notices as separate ordered occurrences', () => {
    const p = parser();
    for (let i = 0; i < 20; i++) p.pushEvent(notice, i);
    const items = p.history[0].items;
    expect(items).toHaveLength(20);
    expect(new Set(items.map((item) => item.id)).size).toBe(20);
    expect(items.map((item) => item.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(p.historyRevision).toBe(20);
  });

  it('assigns an ordinal after nested tools and preserves their ownership', () => {
    const p = parser();
    for (const [toolCallId, parentToolCallId] of [
      ['parent', null],
      ['child', 'parent'],
    ] as const) {
      p.pushEvent(
        {
          kind: 'tool_call',
          toolCallId,
          parentToolCallId,
          title: 'Run',
          toolKind: 'execute',
          status: 'in_progress',
          diffs: [],
          locations: [],
        },
        0
      );
    }
    p.pushEvent(notice, 1);
    expect(p.activeTurn?.items.at(-1)).toMatchObject({ kind: 'notification', seq: 2 });
    p.pushEvent(
      { kind: 'tool_update', toolCallId: 'child', parentToolCallId: 'parent', status: 'completed' },
      2
    );
    expect(p.activeTurn?.items[0]).toMatchObject({
      toolCallId: 'parent',
      children: [{ toolCallId: 'child', status: 'done' }],
    });
    expect(p.activeTurn?.items.at(-1)).toMatchObject(notice);
  });

  it('amends only the current turn and keeps previously committed references stable', () => {
    const p = parser();
    p.pushEvent(message('user', 'Earlier'), 0);
    p.endTurn(1);
    const previous = p.history;
    p.pushEvent(message('user', 'Current'), 2);
    p.pushEvent(notice, 3);
    expect(p.history).toBe(previous);
    expect(p.historyRevision).toBe(1);
    expect(p.activeTurn?.items.at(-1)).toMatchObject(notice);
  });

  it('replay reset replaces notices and reconstructs stable identities', () => {
    const p = parser();
    p.pushEvent(notice, 0);
    const original = p.history;
    const generation = p.position.generation;
    p.beginReplay(1);
    expect(p.history).toEqual([]);
    expect(p.historyRevision).toBe(0);
    p.pushEvent(notice, 2);
    p.endReplay(3);
    expect(p.history).toEqual(original);
    expect(p.position.generation).not.toBe(generation);
    expect(p.activeTurn).toBeNull();
  });
});
