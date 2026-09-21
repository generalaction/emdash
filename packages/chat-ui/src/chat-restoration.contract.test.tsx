import { DEFAULT_THEME } from '@core/theme';
import type { TranscriptSnapshot } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { TranscriptTurn } from '@/model';
import { connectSession, createChatState } from '@/state/chat-state';

const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

function userTurn(promptId: string, seq = 0): TranscriptTurn {
  return {
    id: `turn-${promptId}`,
    seq,
    initiator: 'user',
    items: [
      { kind: 'message', id: `message-${promptId}`, seq: 0, role: 'user', text: 'Hello', promptId },
    ],
  };
}

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

describe('conversation restoration', () => {
  it('keeps a submitted message visible after switching away and back', async () => {
    const context = createChatContext({ theme: DEFAULT_THEME });
    const a = createChatState(context, { uri: 'a' });
    const b = createChatState(context, { uri: 'b' });
    a.transcript.history.seed([userTurn('previous')]);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px';
    document.body.append(parent);
    const view = createChatView({ context, state: a, parent });
    try {
      a.session.setPendingPrompt({ id: 'latest', text: 'My newest message' });
      await nextPaint();
      expect(parent.querySelector('[data-user-card="latest"]')).not.toBeNull();
      view.setModel(b);
      await nextPaint();
      view.setModel(a);
      await nextPaint();
      expect(a.session.state.pendingPrompt?.id).toBe('latest');
      expect(parent.querySelector('[data-user-card="latest"]')).not.toBeNull();
    } finally {
      view.dispose();
      a.dispose();
      b.dispose();
      context.dispose();
      parent.remove();
    }
  });

  it('keeps coherent state authoritative when replay temporarily omits the transcript', () => {
    const context = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(context);
    const activeTurn = source<TranscriptTurn | null>(userTurn('legacy'));
    const sessionState = source<{ pendingPermissions: []; transcript?: TranscriptSnapshot }>({
      pendingPermissions: [],
      transcript: {
        generation: 'one',
        historyRevision: 0,
        lastCommittedTurnSeq: null,
        activeTurn: userTurn('current'),
      },
    });
    const disconnect = connectSession(state, { activeTurn, sessionState, plan: source(null) });
    try {
      expect(state.transcript.state.activeTurnSnapshot?.id).toBe('turn-current');
      sessionState.set({ pendingPermissions: [] });
      activeTurn.set(userTurn('stale'));
      expect(state.transcript.state.activeTurnSnapshot?.id).toBe('turn-current');
    } finally {
      disconnect();
      state.dispose();
      context.dispose();
    }
  });

  it('reconciles only the matching prompt, even without a mounted view', async () => {
    const context = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(context);
    const activeTurn = source<TranscriptTurn | null>(null);
    const disconnect = connectSession(state, {
      activeTurn,
      plan: source(null),
      sessionState: source({ pendingPermissions: [] }),
    });
    try {
      state.session.setPendingPrompt({ id: 'latest', text: 'Hello' });
      activeTurn.set(userTurn('previous'));
      await nextPaint();
      expect(state.session.state.pendingPrompt?.id).toBe('latest');
      activeTurn.set(null);
      state.transcript.history.seed([userTurn('previous')]);
      await nextPaint();
      expect(state.session.state.pendingPrompt?.id).toBe('latest');
      state.transcript.history.seed([userTurn('previous'), userTurn('latest', 1)]);
      await nextPaint();
      expect(state.session.state.pendingPrompt).toBeNull();

      state.session.setPendingPrompt({ id: 'next', text: 'Hello' });
      activeTurn.set(userTurn('next', 2));
      await nextPaint();
      expect(state.session.state.pendingPrompt).toBeNull();
    } finally {
      disconnect();
      state.dispose();
      context.dispose();
    }
  });
});
