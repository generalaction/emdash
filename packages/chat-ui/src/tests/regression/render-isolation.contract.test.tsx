/**
 * Regression suite: render isolation in ChatRoot.
 *
 * Guards audit finding F1: expanding one user message card must not recreate
 * the DOM of any other visible row. The global expanded-card id is scoped to a
 * per-row `expandedSelf` boolean before it enters MeasureCtx, so rows the
 * expand cannot affect never see a changed measure input.
 *
 * Verified by node-identity sampling: capture element references from other
 * rows' message bodies before the expand and assert the exact same nodes are
 * still connected afterwards.
 *
 * Run:
 *   cd packages/chat-ui
 *   pnpm exec vitest run --project browser src/tests/regression/render-isolation.contract.test.tsx
 */

import { DEFAULT_THEME } from '@core/theme';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { ChatRoot } from '@/ChatRoot';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

type TurnItem = TranscriptTurn['items'][number];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Transcript shaped for the scenario: a LONG user message first (overflows the
 * collapsed max-height so it is expandable), followed by assistant messages
 * with enough markdown structure that a DOM rebuild would be visible in
 * node-identity sampling.
 */
function makeTurns(): TranscriptTurn[] {
  const longUserText = Array.from(
    { length: 30 },
    (_, i) => `User line ${i}: some request text that keeps the card overflowing.`
  ).join('\n\n');
  const assistantText = (i: number) =>
    `**Answer ${i}** with some prose.\n\n- item one\n- item two\n\n` +
    '```ts\nconst x = 1;\n```\n\nAnd a closing paragraph for message ' +
    `${i}.`;

  const turns: TranscriptTurn[] = [
    {
      id: 'turn-user',
      seq: 0,
      initiator: 'user',
      items: [
        { kind: 'message', id: 'u-long', seq: 0, role: 'user', text: longUserText } as TurnItem,
      ],
    },
  ];
  for (let i = 0; i < 4; i++) {
    turns.push({
      id: `turn-a-${i}`,
      seq: i + 1,
      initiator: 'agent',
      items: [
        {
          kind: 'message',
          id: `m-${i}`,
          seq: 0,
          role: 'assistant',
          text: assistantText(i),
        } as TurnItem,
      ],
    });
  }
  return turns;
}

describe('render isolation regression', () => {
  it('expanding one user card does not recreate DOM nodes of other rows', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:880px;height:600px;overflow:hidden;position:relative;';
    document.body.appendChild(host);
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(ctx);
    state.transcript.history.seed(makeTurns());
    const dispose = render(() => <ChatRoot context={ctx} state={state} />, host);
    const scrollEl = host.querySelector('[data-chat-scroll]') as HTMLElement;

    try {
      await sleep(400);
      // Scroll to the top so the user card and the assistant rows after it
      // stay in the visible window across the expand.
      scrollEl.scrollTop = 0;
      await sleep(300);

      const card = host.querySelector('[data-user-card="u-long"]') as HTMLElement;
      expect(card).not.toBeNull();
      const cardHeightBefore = card.getBoundingClientRect().height;

      // Sample every DOM node inside the OTHER rows' subtrees.
      const otherRowNodes: Element[] = [];
      for (const row of Array.from(host.querySelectorAll('[data-index]'))) {
        if (row.querySelector('[data-user-card="u-long"]')) continue;
        otherRowNodes.push(...Array.from(row.querySelectorAll('*')));
      }
      expect(otherRowNodes.length).toBeGreaterThan(20);

      // Expand the card (ChatRoot's click handler routes [data-user-card]).
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(400); // expand tween (~200ms) + settle

      // Sanity: the expand actually happened.
      const cardAfter = host.querySelector('[data-user-card="u-long"]') as HTMLElement;
      expect(cardAfter.getBoundingClientRect().height).toBeGreaterThan(cardHeightBefore + 50);

      // Core assertion: every sampled node from other rows survived untouched.
      const disconnected = otherRowNodes.filter((n) => !n.isConnected);
      expect(disconnected).toEqual([]);
    } finally {
      dispose();
      state.dispose();
      ctx.dispose();
      host.remove();
    }
  }, 30000);
});
