import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { ChatThinking, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function thinkingItem(text: string): ChatThinking {
  return {
    kind: 'thinking',
    id: 'thinking-live',
    seq: 0,
    status: 'thinking',
    text,
    startedAt: Date.now() - 2000,
  };
}

function liveTurn(text: string): TranscriptTurn {
  return {
    id: 'turn-live',
    seq: 0,
    initiator: 'agent',
    items: [thinkingItem(text)] as TranscriptTurn['items'],
  };
}

async function mountStreamingThinking() {
  const context = createChatContext();
  const state = createChatState(context);
  state.transcript.history.seed([]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:400px;';
  document.body.appendChild(host);
  const view = createChatView({ context, state, parent: host });

  cleanups.push(() => {
    view.dispose();
    state.dispose();
    context.dispose();
    host.remove();
  });

  state.transcript.activeTurn.set(liveTurn('Considering the'));
  await nextPaint();
  return { state, host };
}

describe('thinking def contract', () => {
  it('keeps at most one elapsed-time interval alive across streaming chunks', async () => {
    const setSpy = vi.spyOn(window, 'setInterval');
    const clearSpy = vi.spyOn(window, 'clearInterval');

    const { state } = await mountStreamingThinking();

    let text = 'Considering the';
    for (let chunk = 0; chunk < 5; chunk++) {
      text += ` transcript reducer and the segment boundary, part ${chunk}.`;
      state.transcript.activeTurn.set(liveTurn(text));
      await nextPaint();
    }

    const created = setSpy.mock.results.map((result) => result.value as number);
    const cleared = new Set(clearSpy.mock.calls.map((call) => call[0] as number));
    const alive = created.filter((id) => !cleared.has(id));
    expect(alive.length).toBeLessThanOrEqual(1);

    // Dispose the view: every interval ever created must now be cleared.
    for (const cleanup of cleanups.splice(0)) cleanup();
    const clearedAfter = new Set(clearSpy.mock.calls.map((call) => call[0] as number));
    const aliveAfter = created.filter((id) => !clearedAfter.has(id));
    expect(aliveAfter).toEqual([]);
  });
});
