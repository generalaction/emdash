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

  it('retains visible content while replay has no authoritative transcript', () => {
    const context = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(context);
    const sessionState = source<{ pendingPermissions: []; transcript: TranscriptSnapshot | null }>({
      pendingPermissions: [],
      transcript: {
        generation: 'one',
        historyRevision: 0,
        lastCommittedTurnSeq: null,
        activeTurn: userTurn('current'),
      },
    });
    const disconnect = connectSession(state, { sessionState, plan: source(null) });
    try {
      expect(state.transcript.state.activeTurnSnapshot?.id).toBe('turn-current');
      sessionState.set({ pendingPermissions: [], transcript: null });
      expect(state.transcript.state.activeTurnSnapshot).toBeNull();
      expect(state.transcript.state.displayTurns.map((turn) => turn.id)).toEqual(['turn-current']);
      expect(state.transcript.needsHistory).toBe(false);
    } finally {
      disconnect();
      state.dispose();
      context.dispose();
    }
  });

  it('reconciles only the matching prompt, even without a mounted view', async () => {
    const context = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(context);
    const sessionState = source<{ pendingPermissions: []; transcript: TranscriptSnapshot | null }>({
      pendingPermissions: [],
      transcript: null,
    });
    const publish = (activeTurn: TranscriptTurn | null) =>
      sessionState.set({
        pendingPermissions: [],
        transcript: {
          generation: 'test',
          historyRevision: 0,
          lastCommittedTurnSeq: null,
          activeTurn,
        },
      });
    const disconnect = connectSession(state, {
      plan: source(null),
      sessionState,
    });
    try {
      state.session.setPendingPrompt({ id: 'latest', text: 'Hello' });
      publish(userTurn('previous'));
      await nextPaint();
      expect(state.session.state.pendingPrompt?.id).toBe('latest');
      publish(null);
      state.transcript.history.seed([userTurn('previous')]);
      await nextPaint();
      expect(state.session.state.pendingPrompt?.id).toBe('latest');
      state.transcript.history.seed([userTurn('previous'), userTurn('latest', 1)]);
      await nextPaint();
      expect(state.session.state.pendingPrompt).toBeNull();

      state.session.setPendingPrompt({ id: 'next', text: 'Hello' });
      publish(userTurn('next', 2));
      await nextPaint();
      expect(state.session.state.pendingPrompt).toBeNull();
    } finally {
      disconnect();
      state.dispose();
      context.dispose();
    }
  });
});
