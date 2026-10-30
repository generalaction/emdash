import { describe, expect, it, vi } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { UserMessageNavigation } from '@/chat-view';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

function turn(id: string, seq: number, text = `Prompt ${id}`): TranscriptTurn {
  return {
    id: `turn-${id}`,
    seq,
    initiator: 'user',
    items: [
      { kind: 'message', id, seq: 0, role: 'user', text },
      {
        kind: 'message',
        id: `${id}-reply`,
        seq: 1,
        role: 'assistant',
        text: Array.from({ length: 8 }, (_, i) => `Response ${id}, paragraph ${i}.`).join('\n\n'),
      },
    ],
  };
}

function setup(turns: TranscriptTurn[] = []) {
  const context = createChatContext();
  const state = createChatState(context, { uri: 'navigation-a' });
  state.transcript.history.seed(turns);
  const parent = document.createElement('div');
  parent.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:320px';
  document.body.append(parent);
  const onNavigation = vi.fn<(navigation: UserMessageNavigation) => void>();
  const view = createChatView({
    context,
    state,
    parent,
    padTop: 16,
    padBottom: 24,
    stickToBottom: true,
    onUserMessageNavigationChange: onNavigation,
  });
  return {
    context,
    state,
    parent,
    view,
    onNavigation,
    navigation: () => onNavigation.mock.lastCall?.[0],
    scroll: () => parent.querySelector<HTMLElement>('[data-chat-scroll]')!,
    card: (id: string) =>
      parent.querySelector<HTMLElement>(`[data-chat-canvas] [data-user-card="${id}"]`),
    dispose(otherStates: ReturnType<typeof createChatState>[] = []) {
      view.dispose();
      state.dispose();
      for (const other of otherStates) other.dispose();
      context.dispose();
      parent.remove();
    },
  };
}

describe('user message navigation', () => {
  it('lists committed, active and pending prompts in order, deduplicating IDs rather than text', async () => {
    const h = setup([turn('committed', 0, 'continue'), turn('shared', 1, 'continue')]);
    try {
      const active = turn('live', 2, 'Live request');
      h.state.transcript.activeTurn.set({
        ...active,
        items: [
          { kind: 'message', id: 'shared', seq: 0, role: 'user', text: 'continue' },
          ...active.items.map((item) => ({ ...item, seq: item.seq + 1 })),
        ],
      });
      h.state.session.setPendingPrompt({ id: 'pending', text: 'Queued locally' });
      await vi.waitFor(() =>
        expect(h.navigation()?.items).toEqual([
          { id: 'committed', text: 'continue' },
          { id: 'shared', text: 'continue' },
          { id: 'live', text: 'Live request' },
          { id: 'pending', text: 'Queued locally' },
        ])
      );

      h.state.session.setPendingPrompt({ id: 'live', text: 'Live request' });
      await vi.waitFor(() =>
        expect(h.navigation()?.items).toEqual([
          { id: 'committed', text: 'continue' },
          { id: 'shared', text: 'continue' },
          { id: 'live', text: 'Live request' },
        ])
      );
      expect(h.state.session.state.pendingPrompt?.id).toBe('live');
    } finally {
      h.dispose();
    }
  });

  it('refreshes navigation on model switches and ignores updates from the inactive model', async () => {
    const h = setup([turn('a-first', 0), turn('a-second', 1)]);
    const b = createChatState(h.context, { uri: 'navigation-b' });
    b.transcript.history.seed([turn('b-first', 0), turn('b-second', 1)]);
    try {
      await vi.waitFor(() => expect(h.navigation()?.items).toHaveLength(2));
      h.view.scrollToItem('a-first', { align: 'start' });
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('a-first'));
      h.view.setModel(b);
      await vi.waitFor(() =>
        expect(h.navigation()?.items.map((item) => item.id)).toEqual(['b-first', 'b-second'])
      );
      h.view.scrollToItem('b-first', { align: 'start' });
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('b-first'));

      h.state.transcript.activeTurn.set(turn('a-live', 2));
      await nextPaint();
      expect(h.navigation()?.items.map((item) => item.id)).toEqual(['b-first', 'b-second']);
      expect(h.navigation()?.currentId).toBe('b-first');
      b.session.setPendingPrompt({ id: 'b-pending', text: 'New request B' });
      await vi.waitFor(() => expect(h.navigation()?.items.at(-1)?.id).toBe('b-pending'));

      h.view.setModel(h.state);
      await vi.waitFor(() =>
        expect(h.navigation()?.items.map((item) => item.id)).toEqual([
          'a-first',
          'a-second',
          'a-live',
        ])
      );
      expect(h.navigation()?.currentId).toBe('a-first');
    } finally {
      h.dispose([b]);
    }
  });

  it('navigates to an early virtualized prompt and updates the current prompt while scrolling', async () => {
    const h = setup(Array.from({ length: 48 }, (_, i) => turn(`user-${i}`, i)));
    try {
      await vi.waitFor(() => expect(h.navigation()?.items).toHaveLength(48));
      h.view.scrollToBottom();
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-47'));
      expect(h.scroll().scrollTop).toBeGreaterThan(1000);
      expect(h.card('user-2')).toBeNull();

      h.view.scrollToItem('user-2', { align: 'start' });
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-2'));
      await vi.waitFor(() => expect(h.card('user-2')).not.toBeNull());
      await nextPaint();
      const targetTop = h.card('user-2')!.getBoundingClientRect().top;
      const viewportTop = h.scroll().getBoundingClientRect().top;
      expect(targetTop - viewportTop).toBeGreaterThanOrEqual(-1);
      expect(targetTop - viewportTop).toBeLessThan(100);

      h.scroll().scrollTop = 0;
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-0'));
      h.view.scrollToBottom();
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-47'));
    } finally {
      h.dispose();
    }
  });

  it('keeps a selected earlier prompt anchored as the active response grows and commits', async () => {
    const history = Array.from({ length: 24 }, (_, i) => turn(`user-${i}`, i));
    const h = setup(history);
    try {
      h.state.transcript.activeTurn.set(turn('live', 24), 'generating');
      await vi.waitFor(() => expect(h.navigation()?.items).toHaveLength(25));
      h.view.scrollToItem('user-3', { align: 'start' });
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-3'));
      await vi.waitFor(() => expect(h.card('user-3')).not.toBeNull());
      await nextPaint();
      const beforeTop = h.card('user-3')!.getBoundingClientRect().top;
      const beforeScroll = h.scroll().scrollTop;

      for (const paragraphs of [16, 32, 64]) {
        const active = turn('live', 24);
        active.items[1] = {
          kind: 'message',
          id: 'live-reply',
          seq: 1,
          role: 'assistant',
          text: 'The active response continues growing.\n\n'.repeat(paragraphs),
        };
        h.state.transcript.activeTurn.set(active, 'generating');
        await nextPaint();
        expect(h.navigation()?.currentId).toBe('user-3');
        expect(Math.abs(h.scroll().scrollTop - beforeScroll)).toBeLessThan(1);
        expect(Math.abs(h.card('user-3')!.getBoundingClientRect().top - beforeTop)).toBeLessThan(1);
      }
      h.state.transcript.activeTurn.commit('done');
      await nextPaint();
      expect(h.navigation()?.currentId).toBe('user-3');
      expect(h.navigation()?.items.filter((item) => item.id === 'live')).toHaveLength(1);
      expect(Math.abs(h.scroll().scrollTop - beforeScroll)).toBeLessThan(1);
    } finally {
      h.dispose();
    }
  });

  it('prepends older prompts without moving the reading position or changing the current ID', async () => {
    const h = setup(Array.from({ length: 24 }, (_, i) => turn(`user-${i + 12}`, i + 12)));
    try {
      await vi.waitFor(() => expect(h.navigation()?.items).toHaveLength(24));
      h.view.scrollToItem('user-16', { align: 'start' });
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('user-16'));
      await vi.waitFor(() => expect(h.card('user-16')).not.toBeNull());
      await nextPaint();
      const beforeTop = h.card('user-16')!.getBoundingClientRect().top;
      const beforeScroll = h.scroll().scrollTop;

      h.view.loadOlder(Array.from({ length: 12 }, (_, i) => turn(`user-${i}`, i)));
      await vi.waitFor(() => expect(h.navigation()?.items).toHaveLength(36));
      await nextPaint();
      expect(h.navigation()?.items.map((item) => item.id)).toEqual(
        Array.from({ length: 36 }, (_, i) => `user-${i}`)
      );
      expect(h.navigation()?.currentId).toBe('user-16');
      expect(h.scroll().scrollTop).toBeGreaterThan(beforeScroll);
      expect(Math.abs(h.card('user-16')!.getBoundingClientRect().top - beforeTop)).toBeLessThan(1);
    } finally {
      h.dispose();
    }
  });

  it('reports viewport and padding changes independently of the loaded prompts', async () => {
    const h = setup([turn('only', 0)]);
    try {
      await vi.waitFor(() => expect(h.navigation()?.bottomInset).toBeGreaterThanOrEqual(24));
      const beforeInset = h.navigation()!.bottomInset;
      h.view.setContentPadding({ bottom: 144 });
      await vi.waitFor(() => expect(h.navigation()?.bottomInset).toBe(beforeInset + 120));
      h.parent.style.height = '240px';
      await vi.waitFor(() => expect(h.navigation()?.viewportHeight).toBe(240));
      expect(h.navigation()?.items).toEqual([{ id: 'only', text: 'Prompt only' }]);
    } finally {
      h.dispose();
    }
  });

  it('reports empty navigation and clears the previous conversation selection', async () => {
    const h = setup();
    const populated = createChatState(h.context, { uri: 'populated' });
    populated.transcript.history.seed([turn('previous', 0)]);
    try {
      await vi.waitFor(() => expect(h.navigation()).toMatchObject({ items: [], currentId: null }));
      h.view.setModel(populated);
      await vi.waitFor(() => expect(h.navigation()?.currentId).toBe('previous'));
      h.view.setModel(h.state);
      await vi.waitFor(() => expect(h.navigation()).toMatchObject({ items: [], currentId: null }));
    } finally {
      h.dispose([populated]);
    }
  });
});
