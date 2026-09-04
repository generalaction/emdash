import { afterEach, describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { ChatThinking, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function steps(status: 'thinking' | 'done' = 'done'): ChatThinking[] {
  const now = Date.now();
  return [
    {
      kind: 'thinking',
      id: 'thinking-1',
      seq: 0,
      status: 'done',
      text: 'First I inspected the transcript reducer and identified the segment boundary.',
      startedAt: now - 9000,
      durationMs: 9000,
    },
    {
      kind: 'thinking',
      id: 'thinking-2',
      seq: 1,
      status,
      text: 'Then I checked the renderer and chose a presentation-only grouping boundary.',
      startedAt: now - 7000,
      ...(status === 'done' ? { durationMs: 7000 } : {}),
    },
  ];
}

async function mountThinkingGroup(status: 'thinking' | 'done' = 'done') {
  const context = createChatContext();
  const state = createChatState(context);
  const turn: TranscriptTurn = {
    id: 'turn-1',
    seq: 0,
    initiator: 'agent',
    items: steps(status) as TranscriptTurn['items'],
  };
  state.transcript.history.seed([turn]);

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

  await nextPaint();
  const header = host.querySelector<HTMLElement>('[data-collapse-id="thinking-1:thinking-group"]');
  if (!header) throw new Error('Thinking group header did not render');
  return { header, host };
}

describe('thinking group contract', () => {
  it('renders one collapsed summary with summed duration', async () => {
    const { header, host } = await mountThinkingGroup();

    expect(header.textContent).toContain('Reasoned in 2 steps · 16s');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-collapse-id="thinking-1"]')).toBeNull();
  });

  it('reveals collapsed thinking rows that expand independently', async () => {
    const { header, host } = await mountThinkingGroup();
    header.click();
    await nextPaint();

    const firstStep = host.querySelector<HTMLElement>('[data-collapse-id="thinking-1"]');
    const secondStep = host.querySelector<HTMLElement>('[data-collapse-id="thinking-2"]');
    expect(firstStep?.getAttribute('aria-expanded')).toBe('false');
    expect(secondStep?.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('First I inspected the transcript reducer');

    firstStep?.click();
    await nextPaint();

    expect(firstStep?.getAttribute('aria-expanded')).toBe('true');
    expect(secondStep?.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('First I inspected the transcript reducer');
    expect(host.textContent).not.toContain('Then I checked the renderer');
  });

  it('preserves a child expansion when the parent is closed and reopened', async () => {
    const { header, host } = await mountThinkingGroup();
    header.click();
    await nextPaint();

    host.querySelector<HTMLElement>('[data-collapse-id="thinking-1"]')?.click();
    await nextPaint();
    header.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await nextPaint();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-collapse-id="thinking-1"]')).toBeNull();

    header.click();
    await nextPaint();
    expect(
      host
        .querySelector<HTMLElement>('[data-collapse-id="thinking-1"]')
        ?.getAttribute('aria-expanded')
    ).toBe('true');
    expect(host.textContent).toContain('First I inspected the transcript reducer');
  });

  it('shows the active step preview only after revealing the child rows', async () => {
    const { header, host } = await mountThinkingGroup('thinking');

    expect(header.textContent).toContain('Reasoning · step 2');
    expect(host.textContent).not.toContain('presentation-only grouping boundary');

    header.click();
    await nextPaint();
    expect(host.textContent).toContain('presentation-only grouping boundary');
  });
});
