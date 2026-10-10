import { afterEach, describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';
import { srOnly } from '@components/rows/message/message.css';

const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function turn(text: string, role: 'user' | 'assistant' = 'user'): TranscriptTurn {
  return {
    id: 'turn',
    seq: 0,
    initiator: role === 'user' ? 'user' : 'agent',
    items: [{ kind: 'message', id: 'message', seq: 0, role, text }],
  };
}

function mount(turns: TranscriptTurn[], width = 800) {
  const context = createChatContext();
  const state = createChatState(context, { uri: 'original' });
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

// Check the actual rendered prose, not only textContent on the card: the card
// also has an sr-only mirror which can make a blank visual falsely pass.
function prose(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-block-id^="message#"]'));
}

function expectPainted(root: ParentNode, expected: string) {
  const blocks = prose(root);
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks.map((block) => block.textContent).join('')).toContain(expected);
  for (const block of blocks) {
    expect(block.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(block.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(block).visibility).toBe('visible');
    expect(getComputedStyle(block).display).not.toBe('none');
  }
}

describe('message content visibility', () => {
  for (const role of ['user', 'assistant'] as const) {
    it.each([
      [
        'notification',
        '<task-notification>\nMonitor finished\n</task-notification>',
        'Monitor finished',
      ],
      ['HTML block', '<div>Inspect this markup</div>', '<div>Inspect this markup</div>'],
      ['inline HTML', 'Use <widget>value</widget> here.', 'Use <widget>value</widget> here.'],
      ['comment', '<!-- Diagnostic message -->', '<!-- Diagnostic message -->'],
      ['ordinary Markdown', '**Please** inspect `file.ts`', 'Please'],
    ])(`paints %s in a ${role} message`, async (_label, text, expected) => {
      const h = mount([turn(text, role)]);
      await paint();
      h.view.scrollToTop();
      await paint();
      expectPainted(h.host, expected);
      expect(h.host.querySelector(`.${srOnly}`)?.textContent).toContain(expected);
    });
  }

  it('paints XML in the pinned card as well as the inline card', async () => {
    const transcript = turn('<task-notification>\nMonitor finished\n</task-notification>');
    transcript.items.push({
      kind: 'message',
      id: 'reply',
      seq: 1,
      role: 'assistant',
      text: 'The monitor ended on its own.\n\n'.repeat(30),
    });
    const h = mount([transcript]);
    await paint();
    h.view.scrollToTop();
    await paint();
    const inline = h.host.querySelector('[data-chat-canvas] [data-user-card]');
    expect(inline).not.toBeNull();
    expectPainted(inline!, 'Monitor finished');

    h.view.scrollToBottom();
    await paint();
    const pinned = h.host.querySelector('[aria-hidden="true"] [data-user-card]');
    expect(pinned).not.toBeNull();
    expectPainted(pinned!, 'Monitor finished');
  });

  it.each(['remount', 'switch', 'delayed history'] as const)(
    'keeps tagged text visible after %s',
    async (mode) => {
      const original = turn('<system-reminder>Original message</system-reminder>');
      const h = mount(mode === 'delayed history' ? [] : [original]);
      await paint();
      if (mode === 'remount') h.remount();
      else if (mode === 'switch') {
        // Reused message IDs across conversations must not leak cached blocks.
        h.other.transcript.history.seed([turn('<div>Other message</div>')]);
        h.view.setModel(h.other);
        await paint();
        expectPainted(h.host, 'Other message');
        h.view.setModel(h.state);
      } else h.state.transcript.history.seed([original]);
      await paint();
      expectPainted(h.host, 'Original message');
      expect(
        prose(h.host)
          .map((block) => block.textContent)
          .join('')
      ).not.toContain('Other message');
    }
  );

  it.each(['user', 'assistant'] as const)(
    'keeps %s text visible through partial tags and turn commit',
    async (role) => {
      const h = mount([]);
      for (const text of [
        '<summary',
        '<summary>',
        '<summary>Monitor finished',
        '<summary>Monitor finished</summary>',
      ]) {
        h.state.transcript.activeTurn.set(turn(text, role), 'generating');
        await paint();
        expectPainted(h.host, text);
      }
      h.state.transcript.activeTurn.commit('done');
      await paint();
      expectPainted(h.host, '<summary>Monitor finished</summary>');
    }
  );

  it.each([320, 800])('wraps multiline markup inside a %ipx user card', async (width) => {
    const text = '<task-notification>\n<summary>Monitor finished</summary>\n</task-notification>';
    const h = mount([turn(text)], width);
    await paint();
    const card = h.host.querySelector<HTMLElement>('[data-chat-canvas] [data-user-card]')!;
    expect(card).not.toBeNull();
    expectPainted(card, 'Monitor finished');
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    const block = prose(card)[0];
    expect(block.getBoundingClientRect().height).toBeGreaterThan(40);
    expect(card.getBoundingClientRect().height).toBeGreaterThan(54);
  });

  it('lets long tagged content expand and scroll to its final line', async () => {
    const text = [
      '<task-notification>',
      ...Array.from({ length: 30 }, (_, i) => `Line ${i}`),
      '</task-notification>',
    ].join('\n');
    const h = mount([turn(text)]);
    await paint();
    const card = h.host.querySelector<HTMLElement>('[data-chat-canvas] [data-user-card]')!;
    expect(card.offsetHeight).toBe(120);
    expectPainted(card, 'Line 29');
    card.click();
    await expect.poll(() => card.offsetHeight).toBe(360);
    await expect.poll(() => getComputedStyle(card).overflowY).toBe('auto');
    card.scrollTop = card.scrollHeight;
    expect(card.scrollTop).toBeGreaterThan(0);
    const finalLine = Array.from(card.querySelectorAll('span')).find(
      (span) => span.textContent === '</task-notification>'
    );
    expect(finalLine).toBeDefined();
    const lineRect = finalLine!.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    expect(lineRect.top).toBeGreaterThanOrEqual(cardRect.top);
    expect(lineRect.bottom).toBeLessThanOrEqual(cardRect.bottom);
  });

  it('keeps an attachment-only user message visible without inventing prose', async () => {
    const transcript = turn('');
    transcript.items = [
      {
        kind: 'message',
        id: 'message',
        seq: 0,
        role: 'user',
        text: '',
        attachments: [{ id: 'image', name: 'capture.png', mimeType: 'image/png' }],
      },
    ];
    const h = mount([transcript]);
    await paint();
    const card = h.host.querySelector('[data-chat-canvas] [data-user-card]')!;
    const attachment = card.querySelector('[title="capture.png"]');
    expect(attachment).not.toBeNull();
    expect(attachment!.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(prose(card)).toHaveLength(0);
  });

  it('renders HTML source without creating active HTML elements', async () => {
    const text = [
      '<script>document.body.dataset.chatInjected = "yes";</script>',
      '<style>body { display: none; }</style>',
      '<img src="invalid" onerror="document.body.dataset.chatInjected = \'yes\'">',
      '<iframe srcdoc="injected"></iframe>',
    ].join('\n');
    const h = mount([turn(text)]);
    await paint();
    expectPainted(h.host, '<script>');
    expectPainted(h.host, '<style>');
    expectPainted(h.host, '<img');
    expectPainted(h.host, '<iframe');
    expect(h.host.querySelector('script, style, img, iframe, [onerror]')).toBeNull();
    expect(document.body.dataset.chatInjected).toBeUndefined();
    expect(getComputedStyle(document.body).display).not.toBe('none');
  });
});
