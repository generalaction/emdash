/**
 * Browser contract tests for createChatView / ChatView.setModel.
 *
 * These run in Chromium via @vitest/browser-playwright so they have real DOM
 * layout and Solid's reactive scheduler. They guard against regressions in the
 * Monaco-style model-swap introduced in the ChatView setModel refactor.
 */

import { DEFAULT_THEME } from '@core/theme';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import { generateMockTranscript } from '@/mock-transcript';
import { createChatState } from '@/state/chat-state';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve after two rAF ticks so Solid has committed a reactive update. */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createChatView', () => {
  it('mounts without error', async () => {
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(ctx);
    state.transcript.history.seed(generateMockTranscript(10, 1));

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;';
    document.body.appendChild(host);

    let view: ReturnType<typeof createChatView> | null = null;
    expect(() => {
      view = createChatView({ context: ctx, state, parent: host });
    }).not.toThrow();

    await nextPaint();
    view!.dispose();
    ctx.dispose();
    state.dispose();
    document.body.removeChild(host);
  });
});

describe('ChatView.setModel', () => {
  it('swaps models without throwing', async () => {
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const stateA = createChatState(ctx, { uri: 'conv-a' });
    const stateB = createChatState(ctx, { uri: 'conv-b' });
    stateA.transcript.history.seed(generateMockTranscript(12, 2));
    stateB.transcript.history.seed(generateMockTranscript(12, 3));

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;';
    document.body.appendChild(host);

    const view = createChatView({ context: ctx, state: stateA, parent: host });
    await nextPaint();

    expect(() => view.setModel(stateB)).not.toThrow();
    await nextPaint();

    expect(() => view.setModel(stateA)).not.toThrow();
    await nextPaint();

    view.dispose();
    ctx.dispose();
    stateA.dispose();
    stateB.dispose();
    document.body.removeChild(host);
  });

  it('is a no-op when called with the current model', async () => {
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const stateA = createChatState(ctx, { uri: 'conv-a' });
    stateA.transcript.history.seed(generateMockTranscript(8, 4));

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;';
    document.body.appendChild(host);

    const view = createChatView({ context: ctx, state: stateA, parent: host });
    await nextPaint();

    // Calling setModel with the same state should not throw or crash.
    expect(() => view.setModel(stateA)).not.toThrow();
    await nextPaint();

    view.dispose();
    ctx.dispose();
    stateA.dispose();
    document.body.removeChild(host);
  });

  it('continues rendering streaming updates on the new model after swap', async () => {
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const stateA = createChatState(ctx, { uri: 'conv-a' });
    const stateB = createChatState(ctx, { uri: 'conv-b' });
    stateA.transcript.history.seed(generateMockTranscript(6, 5));
    stateB.transcript.history.seed(generateMockTranscript(6, 6));

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;';
    document.body.appendChild(host);

    const view = createChatView({ context: ctx, state: stateA, parent: host });
    await nextPaint();

    view.setModel(stateB);
    await nextPaint();

    // Stream into stateB after the swap — should not crash.
    expect(() => {
      stateB.transcript.activeTurn.set(
        [{ kind: 'message', id: 'msg-1', role: 'assistant', text: 'Hello from model B' }],
        'generating'
      );
    }).not.toThrow();
    await nextPaint();

    expect(() => {
      stateB.transcript.activeTurn.commit('done');
    }).not.toThrow();
    await nextPaint();

    view.dispose();
    ctx.dispose();
    stateA.dispose();
    stateB.dispose();
    document.body.removeChild(host);
  });

  it('survives rapid model thrashing without error', async () => {
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const states = Array.from({ length: 3 }, (_, i) => {
      const s = createChatState(ctx, { uri: `conv-${i}` });
      s.transcript.history.seed(generateMockTranscript(10, i + 7));
      return s;
    });

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;';
    document.body.appendChild(host);

    const view = createChatView({ context: ctx, state: states[0], parent: host });
    await nextPaint();

    // Thrash through 30 switches.
    const errors: string[] = [];
    for (let i = 0; i < 30; i++) {
      try {
        view.setModel(states[i % states.length]);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    await nextPaint();

    expect(errors).toHaveLength(0);

    view.dispose();
    ctx.dispose();
    for (const s of states) s.dispose();
    document.body.removeChild(host);
  });
});
