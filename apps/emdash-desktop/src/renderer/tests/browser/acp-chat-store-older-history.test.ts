import type { HistoryPage, TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { isObservableProp } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcpLiveSession } from '@core/features/conversations/browser/acp/acp-live-session';
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
const turns = Array.from({ length: 250 }, (_, seq) => makeTurn(seq));
afterEach(async () => {
  await harness?.dispose();
  vi.restoreAllMocks();
});

function olderPage(
  entries: TranscriptTurn[] = turns.slice(50, 150),
  before = 150,
  nextCursor: number | null = 50
): Extract<HistoryPage, { kind: 'available' }> {
  const snapshot = harness.store.session?.sessionState.current().transcript;
  if (!snapshot) throw new Error('Expected a connected transcript');
  return {
    kind: 'available',
    turns: entries,
    nextCursor,
    coverage: { fromSeq: nextCursor, beforeSeq: before },
    position: {
      generation: snapshot.generation,
      historyRevision: snapshot.historyRevision,
      lastCommittedTurnSeq: snapshot.lastCommittedTurnSeq,
    },
  };
}

describe('bounded older history', () => {
  it('loads one page per call, preserves the rendered anchor, and leaves the composer usable', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.bootstrap();
    const store = harness.store;
    for (const field of ['hasOlderHistory', 'olderHistoryLoading', 'olderHistoryError']) {
      expect(isObservableProp(store, field)).toBe(true);
    }
    expect(store.hasOlderHistory).toBe(true);
    expect(harness.committed).toHaveLength(100);
    const anchor = {
      kind: 'anchor' as const,
      itemId: 'user-200',
      edge: 'top' as const,
      offset: 12,
    };
    store.chatState.scroll.set(anchor);
    harness.remount();
    const card = () => harness.parent.querySelector('[data-user-card="user-200"]');
    await vi.waitFor(() => expect(card()).not.toBeNull());
    const top = card()?.getBoundingClientRect().top;
    store.setDraftText('Keep this draft');
    const held = harness.holdNextHistory();
    const loading = store.loadOlderHistory();
    await held.started;
    expect(store.olderHistoryLoading).toBe(true);
    expect(store.historyLoading).toBe(false);
    expect(store.affordances.canSubmit).toBe(true);
    held.release();
    await loading;
    expect(harness.loadHistory).toHaveBeenCalledTimes(2);
    expect(harness.loadHistory).toHaveBeenLastCalledWith(
      { conversationId: 'continuity', before: 150, limit: 100 },
      expect.anything()
    );
    expect(harness.committed.map((turn) => turn.seq)).toEqual(
      turns.slice(50).map((turn) => turn.seq)
    );
    expect(store.messageCount).toBe(400);
    expect(store.hasOlderHistory).toBe(true);
    expect(store.olderHistoryLoading).toBe(false);
    expect(store.olderHistoryError).toBeNull();
    expect(store.draftText).toBe('Keep this draft');
    expect(store.chatState.scroll.get()).toEqual(anchor);
    await vi.waitFor(() => expect(card()?.getBoundingClientRect().top).toBeCloseTo(top ?? 0, 0));

    await store.loadOlderHistory();
    expect(harness.committed).toHaveLength(250);
    expect(harness.loadHistory).toHaveBeenCalledTimes(3);
    expect(harness.loadHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: 50, limit: 100 }),
      expect.anything()
    );
    expect(store.hasOlderHistory).toBe(false);
    await store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenCalledTimes(3);
  });

  it('ignores duplicate clicks while the single older page is pending', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.bootstrap();
    const held = harness.holdNextHistory();
    const loading = harness.store.loadOlderHistory();
    await held.started;
    await harness.store.loadOlderHistory();
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenCalledTimes(2);
    held.release();
    await loading;
    expect(harness.committed).toHaveLength(200);
    expect(harness.store.olderHistoryLoading).toBe(false);
  });

  it.each(['transport', 'runtime', 'unavailable'] as const)(
    'keeps content and the draft on %s failure, then retries the same cursor',
    async (failure) => {
      harness = createContinuityHarness(fixture, turns);
      await harness.bootstrap();
      const store = harness.store;
      const session = store.session;
      if (!session) throw new Error('Expected a live session');
      const loadHistory = vi.spyOn(session, 'loadHistory');
      store.setDraftText('Unsent text');
      const content = harness.committed;
      const anchor = store.chatState.scroll.get();
      if (failure === 'transport') {
        harness.loadHistory.mockRejectedValueOnce(new Error('Temporary history failure'));
      } else if (failure === 'runtime') {
        loadHistory.mockResolvedValueOnce({
          success: false,
          error: { type: 'invalid_state', message: 'Temporary history failure' },
        });
      } else {
        harness.loadHistory.mockResolvedValueOnce(ok({ kind: 'unavailable' }));
      }
      await store.loadOlderHistory();
      expect(harness.committed).toBe(content);
      expect(store.messageCount).toBe(200);
      expect(store.chatState.scroll.get()).toEqual(anchor);
      expect(store.draftText).toBe('Unsent text');
      expect(store.affordances.canSubmit).toBe(true);
      expect(store.loadError).toBeNull();
      expect(store.hasOlderHistory).toBe(true);
      expect(store.olderHistoryLoading).toBe(false);
      expect(store.olderHistoryError).toContain(
        failure === 'unavailable' ? 'unavailable' : 'Temporary history failure'
      );
      await store.loadOlderHistory();
      expect(harness.committed).toHaveLength(200);
      expect(store.olderHistoryError).toBeNull();
      expect(loadHistory.mock.calls.map(([before]) => before)).toEqual([150, 150]);
    }
  );

  it.each(['same cursor', 'later cursor', 'range', 'turn outside range', 'generation', 'revision'])(
    'rejects a page with %s without applying it or advancing the retry cursor',
    async (fault) => {
      harness = createContinuityHarness(fixture, turns);
      await harness.bootstrap();
      // Establish a newer accepted revision so applyPage really rejects obsolete pages.
      harness.setHistory(turns);
      await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
      await harness.settleHistoryReads();
      const content = harness.committed;
      const page = olderPage();
      if (fault === 'same cursor') page.nextCursor = page.coverage.fromSeq = 150;
      if (fault === 'later cursor') page.nextCursor = page.coverage.fromSeq = 151;
      if (fault === 'range') page.coverage.beforeSeq = null;
      if (fault === 'turn outside range') page.turns = [makeTurn(150)];
      if (fault === 'generation') page.position.generation = 'obsolete-generation';
      if (fault === 'revision') page.position.historyRevision = 0;
      harness.loadHistory.mockResolvedValueOnce(ok(page));
      await harness.store.loadOlderHistory();
      expect(harness.committed).toBe(content);
      expect(harness.store.hasOlderHistory).toBe(true);
      expect(harness.store.olderHistoryLoading).toBe(false);
      expect(harness.store.olderHistoryError).not.toBeNull();
      expect(harness.store.loadError).toBeNull();
      await harness.store.loadOlderHistory();
      expect(harness.committed).toHaveLength(200);
      expect(harness.store.olderHistoryError).toBeNull();
      expect(harness.loadHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ before: 150 }),
        expect.anything()
      );
    }
  );

  it('preserves the cursor if an in-flight refresh stops above newly loaded older history', async () => {
    harness = createContinuityHarness(fixture, turns.slice(0, 205));
    await harness.bootstrap();
    const refresh = harness.holdNextHistory();
    harness.setHistory(turns.slice(0, 206));
    await refresh.started;
    await harness.store.loadOlderHistory();
    expect(harness.committed[0].seq).toBe(5);
    refresh.release();
    await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(4));
    await harness.settleHistoryReads();
    expect(harness.store.hasOlderHistory).toBe(true);
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: 5 }),
      expect.anything()
    );
    expect(harness.committed[0].seq).toBe(0);
    expect(harness.store.hasOlderHistory).toBe(false);
  });

  it('updates the cursor when a refresh covers the oldest loaded boundary', async () => {
    harness = createContinuityHarness(fixture, turns.slice(0, 205));
    await harness.bootstrap();
    await harness.store.loadOlderHistory();
    expect(harness.store.hasOlderHistory).toBe(true);
    harness.setHistory(turns.slice(10, 205));
    await vi.waitFor(() => expect(harness.store.hasOlderHistory).toBe(false));
    const reads = harness.loadHistory.mock.calls.length;
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenCalledTimes(reads);
    expect(harness.committed[0].seq).toBe(10);
  });

  it.each(['success', 'failure'] as const)(
    'ignores a stale epoch %s while a newer request is still loading',
    async (outcome) => {
      harness = createContinuityHarness(fixture, turns);
      await harness.bootstrap();
      const session = harness.store.session;
      if (!session) throw new Error('Expected a live session');
      const oldPage = olderPage();
      const oldResponse = deferred<Awaited<ReturnType<AcpLiveSession['loadHistory']>>>();
      const read = vi.spyOn(session, 'loadHistory').mockReturnValueOnce(oldResponse.promise);
      const oldLoading = harness.store.loadOlderHistory();
      harness.disconnect();
      harness.reconnect();
      await vi.waitFor(() => expect(harness.attach).toHaveResolvedTimes(2));
      await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
      await harness.settleHistoryReads();
      const nextResponse = deferred<Awaited<ReturnType<AcpLiveSession['loadHistory']>>>();
      read.mockReturnValueOnce(nextResponse.promise);
      const nextLoading = harness.store.loadOlderHistory();
      expect(harness.store.olderHistoryLoading).toBe(true);
      if (outcome === 'success') oldResponse.resolve(ok(oldPage));
      else oldResponse.reject(new Error('Stale failure'));
      await oldLoading;
      expect(harness.committed).toHaveLength(100);
      expect(harness.store.olderHistoryError).toBeNull();
      expect(harness.store.olderHistoryLoading).toBe(true);
      nextResponse.resolve(ok(olderPage()));
      await nextLoading;
      expect(harness.committed).toHaveLength(200);
      expect(harness.store.olderHistoryLoading).toBe(false);
    }
  );

  it.each(['success', 'failure'] as const)(
    'ignores an older page %s after disposal',
    async (outcome) => {
      harness = createContinuityHarness(fixture, turns);
      await harness.bootstrap();
      const held = harness.holdNextHistory();
      const loading = harness.store.loadOlderHistory();
      await held.started;
      harness.disposeStore();
      const content = harness.committed;
      if (outcome === 'success') held.release();
      else held.reject(new Error('Disposed failure'));
      await loading;
      expect(harness.committed).toBe(content);
      expect(harness.store.olderHistoryError).toBeNull();
      expect(harness.store.olderHistoryLoading).toBe(false);
      await harness.store.loadOlderHistory();
      expect(harness.loadHistory).toHaveBeenCalledTimes(2);
    }
  );

  it('ignores an older page made obsolete by a newer accepted history revision', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.bootstrap();
    const held = harness.holdNextHistory();
    const loading = harness.store.loadOlderHistory();
    await held.started;
    harness.setHistory(turns.map((turn) => makeTurn(turn.seq, `Amended ${turn.seq}`)));
    await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(2));
    const content = harness.committed;
    held.release();
    await loading;
    expect(harness.committed).toBe(content);
    expect(harness.store.olderHistoryError).not.toBeNull();
    await harness.store.loadOlderHistory();
    expect(harness.committed[0].items[0]).toMatchObject({ text: 'Amended 50' });
    expect(harness.store.olderHistoryError).toBeNull();
  });

  it('refreshes the recent tail when an older page arrives before its live revision notification', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.bootstrap();
    const session = harness.store.session;
    if (!session) throw new Error('Expected a live session');
    const page = olderPage();
    page.position.historyRevision += 1;
    page.position.lastCommittedTurnSeq = 250;
    vi.spyOn(session, 'loadHistory').mockResolvedValueOnce(ok(page));

    await harness.store.loadOlderHistory();
    expect(harness.store.olderHistoryError).toBeNull();
    harness.setHistory([...turns, makeTurn(250)]);
    harness.flush();
    await vi.waitFor(() => expect(harness.committed.at(-1)?.seq).toBe(250), { timeout: 3_000 });
  });

  it('rejects an older page behind the live revision while its refresh is still pending', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.bootstrap();
    const older = harness.holdNextHistory();
    const loading = harness.store.loadOlderHistory();
    await older.started;
    const refresh = harness.holdNextHistory();
    harness.setHistory(turns.map((turn) => makeTurn(turn.seq, `Amended ${turn.seq}`)));
    await refresh.started;
    const content = harness.committed;
    older.release();
    await loading;
    expect(harness.committed).toBe(content);
    expect(harness.store.olderHistoryError).not.toBeNull();
    refresh.release();
    await vi.waitFor(() => expect(harness.loadHistory).toHaveResolvedTimes(3));
    await harness.settleHistoryReads();
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: 150 }),
      expect.anything()
    );
    expect(harness.committed[0].items[0]).toMatchObject({ text: 'Amended 50' });
    expect(harness.store.olderHistoryError).toBeNull();
  });

  it('does not fetch older pages before bootstrap or while host access is unavailable', async () => {
    harness = createContinuityHarness(fixture, turns);
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).not.toHaveBeenCalled();
    await harness.bootstrap();
    harness.disconnect();
    await harness.store.loadOlderHistory();
    expect(harness.loadHistory).toHaveBeenCalledTimes(1);
    expect(harness.store.olderHistoryLoading).toBe(false);
    expect(harness.store.hasOlderHistory).toBe(true);
  });

  it.each([false, true])(
    'does not offer paging for unavailable history: %s',
    async (unavailable) => {
      harness = createContinuityHarness(fixture);
      if (unavailable) harness.setHistory([], true);
      harness.startBootstrap();
      await vi.waitFor(() => expect(harness.store.historyLoading).toBe(false));
      expect(harness.store.hasOlderHistory).toBe(false);
      await harness.store.loadOlderHistory();
      expect(harness.loadHistory).toHaveBeenCalledTimes(1);
    }
  );
});
