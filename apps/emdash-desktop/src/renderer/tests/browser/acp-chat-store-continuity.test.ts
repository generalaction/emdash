import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContinuityHarness, makeTurn } from './acp-chat-continuity-harness';

const fixture = vi.hoisted(() => ({ client: undefined as unknown, context: undefined as unknown }));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => fixture.client,
}));
vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => fixture.context,
}));
vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: vi.fn(),
    subject: () => ({
      ready: Promise.resolve(),
      release: async () => {},
      handle: () => ({
        value: { version: '1', text: '', attachments: [] },
        autoPersist: () => () => {},
      }),
    }),
  }),
}));

let harness: ReturnType<typeof createContinuityHarness>;
afterEach(async () => {
  await harness?.dispose();
});

describe('transcript continuity across queued turns', () => {
  it('keeps the current prompt and reply visible when another prompt is only queued', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    await harness.bootstrap();
    const first = makeTurn(1);
    harness.publish(first);
    await harness.observe(first);
    harness.store.submitPrompt('The queued request');
    await vi.waitFor(() =>
      expect(harness.sendPrompt).toHaveResolvedWith({ success: true, data: { queued: true } })
    );
    expect(harness.active?.id).toBe(first.id);
    expect(harness.texts).toContain('Prompt 1');
    expect(harness.texts).toContain('Answer 1');
    expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0']);
  });

  for (const delivery of ['coalesced', 'idle-delivered'] as const) {
    for (const navigation of ['mounted', 'switch', 'remount'] as const) {
      it(`retains the previous turn during handoff: ${delivery}, ${navigation}`, async () => {
        harness = createContinuityHarness(fixture, [makeTurn(0)]);
        await harness.bootstrap();
        const first = makeTurn(1);
        const second = makeTurn(2);
        harness.publish(first);
        await harness.observe(first);
        expect(harness.texts).toContain('Answer 1');
        harness.setHistory([makeTurn(0), first]);
        const held = harness.holdNextHistory();
        if (navigation === 'switch') harness.switchAway();
        if (navigation === 'remount') harness.unmount();
        harness.publish(null);
        if (delivery === 'idle-delivered') await harness.observe(null);
        harness.publish(second);
        await harness.observe(second);
        if (navigation === 'switch') harness.switchBack();
        if (navigation === 'remount') harness.remount();
        held.release();
        await harness.observe(second);
        expect(harness.texts).toContain('Prompt 0');
        expect(harness.texts).toContain('Prompt 2');
        expect(harness.texts).toContain('Prompt 1');
        expect(harness.texts).toContain('Answer 1');
      });
    }
  }
});

describe('history response ordering', () => {
  it.each([1, 3])(
    'loads %i turns that finish entirely between observed snapshots during bootstrap',
    async (count) => {
      harness = createContinuityHarness(fixture);
      const initial = harness.holdNextHistory();
      harness.startBootstrap();
      await initial.started;
      const completed = Array.from({ length: count }, (_, index) => makeTurn(index));
      for (const turn of completed) {
        harness.publish(turn);
        harness.publish(null);
      }
      harness.setHistory(completed);
      harness.flush();
      initial.release();
      await vi.waitFor(() => expect(harness.store.historyLoading).toBe(false));
      await vi.waitFor(() => expect(harness.committed).toHaveLength(count));
    }
  );

  it.each([2, 6])(
    'fills %i unobserved completed turns before the currently streaming turn',
    async (count) => {
      harness = createContinuityHarness(fixture);
      await harness.bootstrap();
      harness.publish(makeTurn(0));
      await harness.observe(makeTurn(0));
      const completed = Array.from({ length: count }, (_, index) => makeTurn(index));
      for (const turn of completed) {
        harness.publish(turn);
        harness.publish(null);
      }
      harness.setHistory(completed);
      harness.publish(makeTurn(count));
      await harness.observe(makeTurn(count));
      await vi.waitFor(() => expect(harness.committed).toHaveLength(count));
      expect(harness.active?.id).toBe(`turn-${count}`);
    }
  );

  it.each(['done', 'cancelled', 'error'] as const)(
    'keeps a settled %s turn visible while its history response is delayed',
    async (outcome) => {
      harness = createContinuityHarness(fixture, [makeTurn(0)]);
      await harness.bootstrap();
      const first = makeTurn(1);
      harness.publish(first);
      await harness.observe(first);
      harness.setHistory([makeTurn(0), { ...first, outcome: { kind: outcome } }]);
      const held = harness.holdNextHistory();
      harness.publish(null);
      await harness.observe(null);
      await held.started;
      expect(harness.texts).toContain('Prompt 1');
      expect(harness.texts).toContain('Answer 1');
      held.release();
    }
  );

  it('installs final content that was coalesced away when the next turn is already active', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    await harness.bootstrap();
    const partial = makeTurn(1);
    harness.publish(partial);
    await harness.observe(partial);
    const final = {
      ...partial,
      items: [
        ...partial.items,
        {
          kind: 'message' as const,
          id: 'final-answer',
          seq: 2,
          role: 'assistant' as const,
          text: 'The final chunk not delivered live',
        },
      ],
      outcome: { kind: 'done' as const },
    };
    harness.setHistory([makeTurn(0), final]);
    harness.publish(null);
    harness.publish(makeTurn(2));
    await harness.observe(makeTurn(2));
    await vi.waitFor(() => expect(harness.texts).toContain('The final chunk not delivered live'));
  });

  it('applies amendments to old tools while a newer turn is streaming', async () => {
    const previous = {
      ...makeTurn(0),
      items: [
        ...makeTurn(0).items,
        {
          kind: 'execute-tool-call' as const,
          id: 'old-tool',
          seq: 2,
          toolCallId: 'old-tool',
          title: 'Background command',
          status: 'running' as const,
        },
      ],
    };
    harness = createContinuityHarness(fixture, [previous]);
    await harness.bootstrap();
    harness.publish(makeTurn(1));
    await harness.observe(makeTurn(1));
    harness.setHistory([
      {
        ...previous,
        items: previous.items.map((item) =>
          item.kind === 'execute-tool-call' && item.id === 'old-tool'
            ? { ...item, status: 'done' as const }
            : item
        ),
      },
    ]);
    harness.publish(makeTurn(1));
    await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
    await vi.waitFor(() =>
      expect(harness.store.chatState.transcript.findItemById('old-tool')).toMatchObject({
        status: 'done',
      })
    );
    expect(harness.active?.id).toBe('turn-1');
  });

  it('does not display a committed turn twice when a trailing live snapshot arrives', async () => {
    const first = makeTurn(1);
    harness = createContinuityHarness(fixture, [{ ...first, outcome: { kind: 'done' } }]);
    harness.publish(first);
    await harness.bootstrap();
    expect(harness.active).toBeNull();
    harness.publish({
      ...first,
      items: [
        ...first.items,
        {
          kind: 'message',
          id: 'late-live-chunk',
          seq: 2,
          role: 'assistant',
          text: 'Final live chunk',
        },
      ],
    });
    await harness.observe(first);
    const ids = [...harness.committed, ...(harness.active ? [harness.active] : [])].map(
      (turn) => turn.id
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recovers turns that complete before the initial history request returns', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    const initial = harness.holdNextHistory();
    harness.startBootstrap();
    await initial.started;
    harness.publish(makeTurn(1));
    await harness.observe(makeTurn(1));
    harness.setHistory([makeTurn(0), makeTurn(1)]);
    harness.publish(null);
    await harness.observe(null);
    initial.release();
    await vi.waitFor(() =>
      expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0', 'turn-1'])
    );
    expect(harness.store.loadError).toBeNull();
  });

  it('fills a multi-page reconnect gap and refreshes amendments beyond the latest page', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    await harness.bootstrap();
    harness.disconnect();
    const completed = Array.from({ length: 205 }, (_, seq) => makeTurn(seq));
    completed[0] = makeTurn(0, 'Amended oldest prompt');
    harness.setHistory(completed);
    harness.publish(makeTurn(205));
    harness.reconnect();
    await vi.waitFor(() => expect(harness.committed).toHaveLength(205));
    expect(harness.committed.map((turn) => turn.seq)).toEqual(completed.map((turn) => turn.seq));
    expect(harness.committed[0].items[0]).toMatchObject({ text: 'Amended oldest prompt' });
    expect(harness.active?.id).toBe('turn-205');
    expect(harness.loadHistory).toHaveBeenCalledWith(
      expect.objectContaining({ before: 105 }),
      expect.anything()
    );
    expect(harness.loadHistory).toHaveBeenCalledWith(
      expect.objectContaining({ before: 5 }),
      expect.anything()
    );
  });

  it('does not duplicate a live turn already present in the initial history response', async () => {
    const first = makeTurn(1);
    harness = createContinuityHarness(fixture, [{ ...first, outcome: { kind: 'done' } }]);
    harness.publish(first);
    await harness.bootstrap();
    expect(harness.committed.map((turn) => turn.id)).toEqual([first.id]);
    expect(harness.active).toBeNull();
  });

  it.each(['before-subscription', 'after-subscription'] as const)(
    'preserves live streaming with unavailable initial history: %s',
    async (timing) => {
      harness = createContinuityHarness(fixture);
      harness.setHistory([], true);
      const initial = harness.holdNextHistory();
      if (timing === 'before-subscription') harness.publish(makeTurn(1));
      harness.startBootstrap();
      await initial.started;
      if (timing === 'after-subscription') {
        harness.publish(makeTurn(1));
        await harness.observe(makeTurn(1));
      }
      expect(harness.active?.id).toBe('turn-1');
      initial.release();
      await vi.waitFor(() => expect(harness.store.historyLoading).toBe(false));
      expect(harness.active?.id).toBe('turn-1');
      expect(harness.store.historyKnown).toBe(false);
      expect(harness.store.loadError).toBeNull();
      expect(harness.texts).toContain('Prompt 1');
    }
  );

  it('does not replace known history with an unavailable refresh', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    await harness.bootstrap();
    harness.setHistory([], true);
    await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
    expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0']);
    expect(harness.store.historyKnown).toBe(true);
  });

  it('retries a failed completion read without erasing prior committed history', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    await harness.bootstrap();
    harness.publish(makeTurn(1));
    await harness.observe(makeTurn(1));
    harness.setHistory([makeTurn(0), makeTurn(1)]);
    harness.loadHistory.mockRejectedValueOnce(new Error('temporary transport failure'));
    harness.publish(null);
    await harness.observe(null);
    expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0']);
    await vi.waitFor(() => expect(harness.committed).toHaveLength(2), { timeout: 2_000 });
    expect(harness.store.loadError).toBeNull();
  });
});

describe('reconnection and view lifetime', () => {
  it.each(['success', 'failure'] as const)(
    'ignores an old generation history %s after another reconnect',
    async (result) => {
      harness = createContinuityHarness(fixture, [makeTurn(0)]);
      await harness.bootstrap();
      harness.disconnect();
      harness.setHistory([makeTurn(0), makeTurn(1)]);
      const old = harness.holdNextHistory();
      harness.reconnect();
      await old.started;
      harness.disconnect();
      harness.setHistory([makeTurn(2)]);
      harness.reconnect();
      await vi.waitFor(() => expect(harness.attach).toHaveResolvedTimes(3));
      if (result === 'success') old.release();
      else old.reject(new Error('old host failed'));
      await vi.waitFor(() => expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-2']), {
        timeout: 2_000,
      });
      await harness.settleHistoryReads();
      expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-2']);
      expect(harness.store.loadError).toBeNull();
    }
  );

  it('recovers a failed bootstrap on retry without duplicating the existing transcript', async () => {
    harness = createContinuityHarness(fixture, [makeTurn(0)]);
    harness.loadHistory.mockRejectedValueOnce(new Error('first read failed'));
    harness.startBootstrap();
    await vi.waitFor(() => expect(harness.store.loadError).not.toBeNull());
    harness.store.retry();
    await vi.waitFor(() => expect(harness.store.loadError).toBeNull());
    await vi.waitFor(() => expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0']));
  });

  it('does not change state after a disposed bootstrap fails', async () => {
    harness = createContinuityHarness(fixture);
    const held = harness.holdNextHistory();
    harness.startBootstrap();
    await held.started;
    harness.disposeStore();
    held.reject(new Error('late failure'));
    await vi.waitFor(() =>
      expect(harness.loadHistory.mock.settledResults).toEqual([
        expect.objectContaining({ type: 'rejected' }),
      ])
    );
    await harness.settleHistoryReads();
    expect(harness.store.loadError).toBeNull();
    expect(harness.committed).toHaveLength(0);
  });

  it.each(['idle', 'working'] as const)(
    'restores missed history while reconnecting %s',
    async (mode) => {
      harness = createContinuityHarness(fixture, [makeTurn(0)]);
      await harness.bootstrap();
      harness.disconnect();
      harness.setHistory([makeTurn(0), makeTurn(1)]);
      const active = mode === 'working' ? makeTurn(2) : null;
      harness.publish(active);
      harness.flush();
      harness.reconnect();
      await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
      await vi.waitFor(() =>
        expect(harness.committed.map((turn) => turn.id)).toEqual(['turn-0', 'turn-1'])
      );
      expect(harness.active?.id ?? null).toBe(active?.id ?? null);
    }
  );

  it.each(['switch', 'unmount'] as const)(
    'keeps updates received while the view is absent: %s',
    async (mode) => {
      harness = createContinuityHarness(fixture, [makeTurn(0)]);
      await harness.bootstrap();
      if (mode === 'switch') harness.switchAway();
      else harness.unmount();
      harness.publish(makeTurn(1));
      await harness.observe(makeTurn(1));
      harness.setHistory([makeTurn(0), makeTurn(1)]);
      harness.publish(null);
      await vi.waitFor(() => expect(harness.committed).toHaveLength(2));
      if (mode === 'switch') harness.switchBack();
      else harness.remount();
      await harness.observe(null);
      expect(harness.texts).toContain('Prompt 1');
      expect(harness.texts).not.toContain('A different conversation');
    }
  );

  it.each(['bootstrap', 'refresh'] as const)(
    'ignores a successful %s response after disposal',
    async (phase) => {
      harness = createContinuityHarness(fixture, [makeTurn(0)]);
      if (phase === 'refresh') await harness.bootstrap();
      const held = harness.holdNextHistory();
      if (phase === 'bootstrap') harness.startBootstrap();
      else harness.setHistory([makeTurn(0)]);
      await held.started;
      const before = harness.committed;
      harness.disposeStore();
      held.release();
      await vi.waitFor(() =>
        expect(harness.loadHistory).toHaveResolvedTimes(phase === 'bootstrap' ? 1 : 2)
      );
      await harness.settleHistoryReads();
      expect(harness.committed).toBe(before);
    }
  );
});
