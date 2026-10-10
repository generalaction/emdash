import { afterEach, describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function turn(
  text = '[Monitor expired after 30m with 12 events delivered. Re-arm it if you still need the watch.]',
  title = 'Monitor event: "main benchmark step results"'
): TranscriptTurn {
  return {
    id: 'turn',
    seq: 0,
    initiator: 'agent',
    items: [{ kind: 'notification', id: 'notice', seq: 0, title, text }],
  };
}

function mount(turns: TranscriptTurn[], width = 800) {
  const context = createChatContext();
  const state = createChatState(context, { uri: 'notifications' });
  const other = createChatState(context, { uri: 'other' });
  state.transcript.history.seed(turns);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;top:0;left:0;width:${width}px;height:500px;`;
  document.body.append(host);
  const makeView = () => createChatView({ context, state, parent: host, pinUserMessages: true });
  let view = makeView();
  cleanups.push(() => {
    view.dispose();
    other.dispose();
    state.dispose();
    context.dispose();
    host.remove();
  });
  return {
    host,
    state,
    other,
    get view() {
      return view;
    },
    remount() {
      view.dispose();
      view = makeView();
    },
  };
}

function visibleNotice(host: HTMLElement) {
  const notice = host.querySelector<HTMLElement>('[data-notification]');
  expect(notice).not.toBeNull();
  const blocks = Array.from(notice!.querySelectorAll<HTMLElement>('[data-block-id]'));
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(block.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(block).visibility).toBe('visible');
  }
  return { notice: notice!, blocks, text: blocks.map((block) => block.textContent).join('\n') };
}

describe('background notification presentation', () => {
  it.each([320, 800])(
    'paints the reported event with measured layout at width %s',
    async (width) => {
      const h = mount([turn()], width);
      await paint();
      const visible = visibleNotice(h.host);
      expect(visible.text).toContain('Monitor event:');
      expect(visible.text).toContain('12 events delivered.');
      expect(visible.notice.getAttribute('role')).toBe('note');
      expect(h.host.querySelector('[data-user-card]')).toBeNull();
      const rect = visible.notice.getBoundingClientRect();
      for (const block of visible.blocks)
        expect(block.getBoundingClientRect().bottom).toBeLessThanOrEqual(rect.bottom + 1);
    }
  );

  it('renders markup as inert literal text in both title and body', async () => {
    const h = mount([
      turn(
        '<script>danger()</script>\n**literal** [link](https://example.com) @file',
        '<img src=x onerror=danger()>'
      ),
    ]);
    await paint();
    const visible = visibleNotice(h.host);
    expect(visible.text).toContain('<img src=x onerror=danger()>');
    expect(visible.text).toContain('<script>danger()</script>');
    expect(visible.text).toContain('**literal**');
    expect(visible.notice.querySelector('script,img,a,button')).toBeNull();
  });

  it.each(['remount', 'tab switch', 'delayed history'] as const)('survives %s', async (mode) => {
    const h = mount(mode === 'delayed history' ? [] : [turn()]);
    await paint();
    if (mode === 'remount') h.remount();
    else if (mode === 'tab switch') {
      h.other.transcript.history.seed([turn('Different event', 'Other monitor')]);
      h.view.setModel(h.other);
      await paint();
      expect(visibleNotice(h.host).text).toContain('Different event');
      h.view.setModel(h.state);
    } else h.state.transcript.history.seed([turn()]);
    await paint();
    expect(visibleNotice(h.host).text).toContain('12 events delivered.');
    expect(h.host.querySelector('[data-user-card]')).toBeNull();
  });

  it('retains notifications when an active turn becomes history', async () => {
    const h = mount([]);
    h.state.transcript.activeTurn.set(turn(), 'generating');
    await paint();
    expect(visibleNotice(h.host).text).toContain('12 events delivered.');
    h.state.transcript.activeTurn.set(null);
    h.state.transcript.history.seed([turn()]);
    await paint();
    expect(visibleNotice(h.host).text).toContain('12 events delivered.');
  });

  it('remeasures after narrowing the viewport without overlapping the next message', async () => {
    const t = turn('Long monitor output with several words that must wrap. '.repeat(8));
    t.items.push({
      kind: 'message',
      id: 'reply',
      seq: 1,
      role: 'assistant',
      text: 'Follow-up response',
    });
    const h = mount([t]);
    await paint();
    const wideHeight = visibleNotice(h.host).notice.getBoundingClientRect().height;
    h.host.style.width = '320px';
    await paint();
    await paint();
    h.view.scrollToTop();
    await paint();
    const narrow = visibleNotice(h.host);
    expect(narrow.notice.getBoundingClientRect().height).toBeGreaterThan(wideHeight);
    h.view.scrollToBottom();
    await paint();
    const reply = h.host.querySelector<HTMLElement>('[data-block-id="reply#0"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Follow-up response');
    const notice = h.host.querySelector<HTMLElement>('[data-notification]');
    if (notice)
      expect(reply!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        notice.getBoundingClientRect().bottom - 1
      );
  });

  it('keeps the real user prompt pinned when a notification follows it', async () => {
    const t = turn();
    t.initiator = 'user';
    t.items.unshift({
      kind: 'message',
      id: 'prompt',
      seq: -1,
      role: 'user',
      text: 'Compare performance on main',
    });
    t.items.push({
      kind: 'message',
      id: 'reply',
      seq: 1,
      role: 'assistant',
      text: 'Detailed results.\n\n'.repeat(35),
    });
    const h = mount([t]);
    await paint();
    h.view.scrollToBottom();
    await paint();
    const pinned = h.host.querySelector('[aria-hidden="true"] [data-user-card]');
    expect(pinned?.textContent).toContain('Compare performance on main');
    expect(pinned?.textContent).not.toContain('Monitor');
  });
});
