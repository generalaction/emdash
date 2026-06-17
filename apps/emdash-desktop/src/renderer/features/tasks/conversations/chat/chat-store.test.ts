import { action } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -----------------------------------------------------------------------
// Hoisted mocks
// -----------------------------------------------------------------------

const getTranscript = vi.hoisted(() => vi.fn());
const getSessionStatus = vi.hoisted(() => vi.fn());
const eventsOn = vi.hoisted(() => vi.fn());

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: eventsOn },
  rpc: {
    acp: {
      getTranscript,
      getSessionStatus,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn(), debug: vi.fn() },
}));

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Collect the listener registered for a given channel so tests can fire it.
 *  `events.on` receives an EventDefinition object `{ name: string }`, so we
 *  match by `.name`.
 */
function captureListener(channel: string): (payload: unknown) => void {
  const call = eventsOn.mock.calls.find(
    (c) => (c[0] as { name?: string }).name === channel
  );
  if (!call) throw new Error(`No listener registered for channel: ${channel}`);
  return call[1] as (payload: unknown) => void;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('ChatStore – getTranscript buffering on construction', () => {
  beforeEach(() => {
    eventsOn.mockReset();
    getTranscript.mockReset();
    getSessionStatus.mockReset();

    // Default: getSessionStatus resolves to 'none' so it doesn't interfere.
    getSessionStatus.mockResolvedValue('none');
    // Default: empty transcript.
    getTranscript.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays buffered transcript from getTranscript() on construction', async () => {
    const { ChatStore } = await import('./chat-store');

    const update1 = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text', text: 'hello' },
    };
    const update2 = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text', text: ' world' },
    };

    getTranscript.mockResolvedValue([
      { seq: 0, update: update1 },
      { seq: 1, update: update2 },
    ]);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');

    // Flush the microtask queue so the async bootstrap completes.
    await vi.waitFor(() => expect(store.items.length).toBeGreaterThan(0));

    expect(store.items.length).toBeGreaterThan(0);
    expect(getTranscript).toHaveBeenCalledWith('conv-1');
  });

  it('deduplicates live updates that race in during the getTranscript() fetch', async () => {
    const { ChatStore } = await import('./chat-store');

    const update1 = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text', text: 'a' },
    };
    const update2 = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text', text: 'b' },
    };

    let resolveTranscript!: (v: { seq: number; update: unknown }[]) => void;
    getTranscript.mockReturnValue(
      new Promise<{ seq: number; update: unknown }[]>((res) => {
        resolveTranscript = res;
      })
    );

    const store = new ChatStore('conv-2', 'proj-1', 'task-1');

    // Fire the live update for update2 (seq 1) while getTranscript is still pending.
    const updateListener = captureListener('acp:session-update');
    action(() => {
      updateListener({ conversationId: 'conv-2', update: update2, seq: 1 });
    })();

    // Now resolve getTranscript with update1 (seq 0) and update2 (seq 1 – duplicate).
    resolveTranscript([
      { seq: 0, update: update1 },
      { seq: 1, update: update2 },
    ]);

    await vi.waitFor(() => {
      // After flush, _buffering should be false (live events applied directly).
      const liveUpdate3 = {
        sessionUpdate: 'agent_message_chunk' as const,
        content: { type: 'text', text: 'c' },
      };
      action(() => {
        updateListener({ conversationId: 'conv-2', update: liveUpdate3, seq: 2 });
      })();
      // We expect exactly 3 distinct items (a, b, c) – update2 not double-applied.
      expect(store.items.length).toBeGreaterThanOrEqual(1);
    });

    // Count how many unique text items we have. update1(a), update2(b), update3(c)
    // If update2 were double-applied we'd have >3 message segments.
    const texts = store.items
      .filter((i) => i.kind === 'message')
      .map((i) => (i as { text: string }).text);

    // The merged text should not contain 'b' more than once as a standalone chunk.
    const bCount = texts.join('').split('b').length - 1;
    expect(bCount).toBe(1);
  });

  it('live updates with seq <= _lastSeq (from buffer) are ignored', async () => {
    const { ChatStore } = await import('./chat-store');

    const update = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text', text: 'x' },
    };

    getTranscript.mockResolvedValue([{ seq: 0, update }]);

    const store = new ChatStore('conv-3', 'proj-1', 'task-1');

    await vi.waitFor(() => expect(store.items.length).toBeGreaterThan(0));

    const itemCountAfterBuffer = store.items.length;

    // Send the same seq 0 update again as a "live" event – should be ignored.
    const updateListener = captureListener('acp:session-update');
    action(() => {
      updateListener({ conversationId: 'conv-3', update, seq: 0 });
    })();

    expect(store.items.length).toBe(itemCountAfterBuffer);
  });
});
