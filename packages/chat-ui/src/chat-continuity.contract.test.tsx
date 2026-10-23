import type { TranscriptSnapshot } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { TranscriptTurn } from '@/model';
import { connectSession, createChatState } from '@/state/chat-state';

function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

function turn(id: string, seq: number, text: string, promptId = id): TranscriptTurn {
  return {
    id,
    seq,
    initiator: 'user',
    items: [{ kind: 'message', id: `${id}-user`, seq: 0, role: 'user', text, promptId }],
  };
}

const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function setup() {
  const context = createChatContext();
  const state = createChatState(context, { uri: 'conversation-a' });
  const other = createChatState(context, { uri: 'conversation-b' });
  const sessionState = source<{ pendingPermissions: []; transcript: TranscriptSnapshot | null }>({
    pendingPermissions: [],
    transcript: null,
  });
  const disconnect = connectSession(state, {
    plan: source(null),
    sessionState,
  });
  const parent = document.createElement('div');
  parent.style.cssText = 'width:800px;height:600px;position:fixed;top:0;left:0';
  document.body.append(parent);
  let view: ReturnType<typeof createChatView> | null = createChatView({ context, state, parent });
  return {
    state,
    other,
    publish(activeTurn: TranscriptTurn | null) {
      sessionState.set({
        pendingPermissions: [],
        transcript: {
          generation: 'test',
          historyRevision: 0,
          lastCommittedTurnSeq: null,
          activeTurn,
        },
      });
    },
    parent,
    away() {
      view?.setModel(other);
    },
    back() {
      view?.setModel(state);
    },
    unmount() {
      view?.dispose();
      view = null;
    },
    remount() {
      view = createChatView({ context, state, parent });
    },
    dispose() {
      disconnect();
      view?.dispose();
      state.dispose();
      other.dispose();
      context.dispose();
      parent.remove();
    },
  };
}

const promptContent = [
  ['repeated text', 'continue'],
  ['empty attachment caption', ''],
  ['unicode', '继续 🔧 café'],
  ['markdown', '**Please** inspect `file.ts`\n\n- first\n- second'],
  ['long message', 'Review this carefully. '.repeat(100)],
] as const;

describe('pending submission identity', () => {
  for (const [label, text] of promptContent) {
    for (const acknowledgement of ['active', 'history'] as const) {
      it(`reconciles ${label} by prompt id through ${acknowledgement}`, async () => {
        const h = setup();
        try {
          h.state.session.setPendingPrompt({
            id: 'pending',
            text,
            ...(text === '' && { attachments: [{ id: 'image', name: 'screenshot.png' }] }),
          });
          h.publish(turn('old', 0, text, 'different-prompt'));
          h.state.transcript.history.replace([turn('older', -1, text, 'another-prompt')]);
          await paint();
          expect(h.state.session.state.pendingPrompt).toMatchObject({ id: 'pending', text });
          if (acknowledgement === 'active') h.publish(turn('new', 1, text, 'pending'));
          else h.state.transcript.history.replace([turn('new', 1, text, 'pending')]);
          await paint();
          expect(h.state.session.state.pendingPrompt).toBeNull();
        } finally {
          h.dispose();
        }
      });
    }
  }

  it.each(['mounted', 'switched', 'unmounted'] as const)(
    'does not let another conversation acknowledge a pending submission while %s',
    async (view) => {
      const h = setup();
      try {
        h.state.session.setPendingPrompt({ id: 'same-id', text: 'The pending prompt' });
        if (view === 'switched') h.away();
        if (view === 'unmounted') h.unmount();
        h.other.transcript.history.replace([
          turn('other-turn', 0, 'The pending prompt', 'same-id'),
        ]);
        await paint();
        expect(h.state.session.state.pendingPrompt?.id).toBe('same-id');
        if (view === 'switched') h.back();
        if (view === 'unmounted') h.remount();
        await paint();
        expect(h.parent.querySelector('[data-user-card="same-id"]')).not.toBeNull();
      } finally {
        h.dispose();
      }
    }
  );

  it.each(['active', 'history'] as const)(
    'acknowledges the right prompt while unmounted through %s',
    async (via) => {
      const h = setup();
      try {
        h.state.session.setPendingPrompt({ id: 'pending', text: 'Hello' });
        h.unmount();
        if (via === 'active') h.publish(turn('new', 0, 'Hello', 'pending'));
        else h.state.transcript.history.replace([turn('new', 0, 'Hello', 'pending')]);
        await paint();
        expect(h.state.session.state.pendingPrompt).toBeNull();
        h.remount();
        await paint();
        expect(h.parent.querySelector('[data-user-card="pending"]')).toBeNull();
        expect(h.parent.querySelector('[data-user-card="new-user"]')).not.toBeNull();
      } finally {
        h.dispose();
      }
    }
  );
});

describe('deterministic stream and navigation stress', () => {
  it.each([1, 7, 23, 101, 997, 65537])(
    'preserves pending identity across 160 event interleavings, seed %i',
    async (seed) => {
      const h = setup();
      let random = seed;
      const next = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random;
      };
      try {
        const pending = { id: 'pending', text: 'continue' };
        h.state.session.setPendingPrompt(pending);
        for (let step = 0; step < 160; step++) {
          switch (next() % 5) {
            case 0:
              h.publish(turn('streaming', 1, `Chunk ${step}`, 'older-prompt'));
              break;
            case 1:
              h.state.transcript.history.replace([
                turn('history', 0, 'continue', 'history-prompt'),
              ]);
              break;
            case 2:
              h.away();
              break;
            case 3:
              h.back();
              break;
            case 4:
              h.other.transcript.history.replace([turn('unrelated', 0, 'continue', 'pending')]);
              break;
          }
          expect(h.state.session.state.pendingPrompt, `seed ${seed}, step ${step}`).toEqual(
            pending
          );
        }
        h.back();
        h.publish(null);
        await paint();
        expect(h.parent.querySelector('[data-user-card="pending"]')).not.toBeNull();
        h.publish(turn('accepted', 2, 'continue', 'pending'));
        await paint();
        expect(h.state.session.state.pendingPrompt).toBeNull();
      } finally {
        h.dispose();
      }
    }
  );
});

describe('independent pending and live presentation', () => {
  it.each(['older-user-turn', 'agent-only-turn', 'empty-live-turn'] as const)(
    'keeps an unacknowledged prompt visible alongside an unrelated %s',
    async (kind) => {
      const h = setup();
      try {
        h.state.session.setPendingPrompt({ id: 'pending', text: 'My latest message' });
        const live: TranscriptTurn =
          kind === 'older-user-turn'
            ? turn('old', 0, 'Earlier prompt')
            : {
                id: 'background',
                seq: 0,
                initiator: 'agent',
                items:
                  kind === 'empty-live-turn'
                    ? []
                    : [
                        {
                          kind: 'message',
                          id: 'background-text',
                          seq: 0,
                          role: 'assistant',
                          text: 'Background work',
                        },
                      ],
              };
        h.publish(live);
        await paint();
        expect(h.state.session.state.pendingPrompt?.id).toBe('pending');
        expect(h.parent.querySelector('[data-user-card="pending"]')).not.toBeNull();
      } finally {
        h.dispose();
      }
    }
  );
});
