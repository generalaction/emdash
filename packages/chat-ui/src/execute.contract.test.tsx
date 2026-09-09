import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { ToolNode, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mountExecute() {
  const context = createChatContext();
  const state = createChatState(context);
  const item: Extract<ToolNode, { kind: 'execute-tool-call' }> = {
    kind: 'execute-tool-call',
    id: 'execute-1',
    seq: 0,
    toolCallId: 'tool-execute-1',
    title: 'git status',
    inputSummary: 'Show working tree status',
    command: 'git status',
    outputText: 'On branch main\nnothing to commit, working tree clean',
    status: 'done',
  };
  const turn: TranscriptTurn = {
    id: 'turn-1',
    seq: 0,
    initiator: 'agent',
    items: [item],
  };
  state.transcript.history.seed([turn]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:300px;';
  document.body.appendChild(host);
  const view = createChatView({ context, state, parent: host });

  cleanups.push(() => {
    view.dispose();
    state.dispose();
    context.dispose();
    host.remove();
  });

  await nextPaint();
  const trigger = host.querySelector<HTMLButtonElement>('button[data-collapse-id="execute-1"]');
  if (!trigger) throw new Error('Execute collapse trigger did not render');
  const card = trigger.parentElement;
  if (!(card instanceof HTMLElement)) throw new Error('Execute card did not render');
  return { host, trigger, card };
}

describe('execute row collapse contract', () => {
  it('renders a compact card and expands it with a pointer', async () => {
    const { host, trigger, card } = await mountExecute();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getComputedStyle(trigger).borderBottomWidth).toBe('0px');
    expect(card.offsetHeight).toBe(34);
    expect(trigger.offsetHeight).toBe(32);
    expect(trigger.offsetWidth).toBe(card.clientWidth);
    expect(host.textContent).not.toContain('$ git status');

    await userEvent.click(trigger);
    await nextPaint();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(trigger).borderBottomWidth).toBe('1px');
    expect(host.textContent).toContain('$ git status');
    expect(card.offsetHeight).toBeGreaterThan(34);
  });

  it('exposes a native button that expands from the keyboard', async () => {
    const { host, trigger } = await mountExecute();

    await userEvent.tab();
    expect(document.activeElement).toBe(trigger);
    const collapsedStyle = getComputedStyle(trigger);
    expect(collapsedStyle.boxShadow).not.toBe('none');
    expect(collapsedStyle.borderTopLeftRadius).not.toBe('0px');
    expect(collapsedStyle.borderTopRightRadius).not.toBe('0px');
    expect(collapsedStyle.borderBottomLeftRadius).not.toBe('0px');
    await userEvent.keyboard('{Enter}');
    await nextPaint();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('$ git status');
    const expandedStyle = getComputedStyle(trigger);
    expect(expandedStyle.borderTopLeftRadius).not.toBe('0px');
    expect(expandedStyle.borderTopRightRadius).not.toBe('0px');
    expect(expandedStyle.borderBottomLeftRadius).toBe('0px');
  });
});
