/**
 * Regression suite: geometry correctness across the full row registry.
 *
 * Sweeps the full mock transcript through a mounted ChatRoot with the debug
 * overlay enabled and collects every row whose actual rendered height diverges
 * from the engine's reserved (measured) height — the core invariant
 * `def.measure(...).height === element.offsetHeight` applied to every row kind
 * at once, at multiple container widths.
 *
 * Run:
 *   cd packages/chat-ui
 *   pnpm exec vitest run --project browser src/tests/regression/geometry-sweep.contract.test.tsx
 */

import { DEFAULT_THEME } from '@core/theme';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { ChatRoot } from '@/ChatRoot';
import { generateMockTranscript } from '@/mock-transcript';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';
import { debugMismatch } from '@components/engine/unit-row.css';

type TurnItem = TranscriptTurn['items'][number];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Adversarial fixtures — content where off-DOM line breaking is most likely
// to disagree with the browser (emoji/ZWJ, CJK, RTL, unbreakable tokens, tabs).
const ADVERSARIAL_TEXTS = [
  'Emoji soup 🧑‍💻🚀✨ family 👨‍👩‍👧‍👦 flags 🇩🇪🇯🇵 skin tones 👍🏽👍🏿 mixed with text that should wrap normally across several lines to exercise the breaker',
  '中文字符串测试，用于验证逐字换行行为。日本語のテキストもここに含まれています。한국어 텍스트도 포함되어 있습니다。 CJK mixed with latin words to force segment switching',
  'A very long unbreakable token: https://example.com/some/extremely/long/path/segment/that/never/ends/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?with=query&params=true',
  'Mixed direction: English ثم النص العربي هنا and back to English, then עברית קצרה here, wrapping across lines',
  'Tabs\tand   multiple   spaces\tinterleaved with `inline code   with   spaces` and **bold text that wraps** plus _italic runs_ repeated enough to wrap: lorem ipsum dolor sit amet consectetur',
  'Combining marks: e\u0301e\u0301e\u0301 a\u0308a\u0308 n\u0303n\u0303 and zero-width\u200bjoiners\u200bin\u200bwords, plus math symbols ∑∏∫≈≠≤≥ and box drawing ┌─┐│└┘',
];

function adversarialTurns(): TranscriptTurn[] {
  return ADVERSARIAL_TEXTS.flatMap((text, i) => {
    // Repeat each text a few times per message so it wraps multiple lines.
    const body = `${text}\n\n${text} ${text}`;
    const items = [
      { kind: 'message', id: `adv-${i}`, seq: 0, role: 'assistant', text: body } as TurnItem,
    ];
    return [{ id: `adv-turn-${i}`, seq: i, initiator: 'agent' as const, items }];
  });
}

type Mismatch = { index: string; text: string; scrollTop: number };

async function sweep(opts: {
  width: number;
  height?: number;
  count?: number;
  richProse?: boolean;
  seed?: number;
  turns?: TranscriptTurn[];
}): Promise<{ mismatches: Mismatch[]; rowsChecked: number }> {
  const height = opts.height ?? 600;
  const host = document.createElement('div');
  host.style.width = `${opts.width}px`;
  host.style.height = `${height}px`;
  host.style.overflow = 'hidden';
  host.style.position = 'relative';
  document.body.appendChild(host);

  const ctx = createChatContext({ theme: DEFAULT_THEME });
  const state = createChatState(ctx);
  state.transcript.history.seed(
    opts.turns ??
      generateMockTranscript(opts.count ?? 96, opts.seed ?? 1, { richProse: opts.richProse })
  );

  const dispose = render(() => <ChatRoot context={ctx} state={state} debug />, host);
  const scrollEl = host.querySelector('[data-chat-scroll]') as HTMLElement;

  const mismatches: Mismatch[] = [];
  const seenMismatchKeys = new Set<string>();
  const checkedIndexes = new Set<string>();

  try {
    await sleep(500); // fonts + initial tail projection settle

    // Sweep top → bottom in half-viewport steps.
    scrollEl.scrollTop = 0;
    await sleep(250);
    const step = Math.floor(height / 2);
    let guard = 0;
    for (;;) {
      // Let overlay ResizeObservers and the measure cycle settle at this stop.
      await sleep(120);
      for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
        const idx = (el as HTMLElement).dataset.index!;
        checkedIndexes.add(idx);
        const bad = el.querySelector(`.${debugMismatch}`);
        if (bad) {
          const key = `${idx}:${bad.textContent}`;
          if (!seenMismatchKeys.has(key)) {
            seenMismatchKeys.add(key);
            mismatches.push({
              index: idx,
              text: bad.textContent ?? '',
              scrollTop: scrollEl.scrollTop,
            });
          }
        }
      }
      const max = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (scrollEl.scrollTop >= max - 1 || guard++ > 400) break;
      scrollEl.scrollTop = Math.min(max, scrollEl.scrollTop + step);
    }
  } finally {
    dispose();
    state.dispose();
    ctx.dispose();
    host.remove();
  }

  return { mismatches, rowsChecked: checkedIndexes.size };
}

describe('geometry sweep — reserved height must equal rendered height for every row', () => {
  it('width 880 (desktop default)', async () => {
    const { mismatches, rowsChecked } = await sweep({ width: 880 });
    // eslint-disable-next-line no-console
    console.log(
      `[880] rowsChecked=${rowsChecked} mismatches=${JSON.stringify(mismatches, null, 1)}`
    );
    expect(rowsChecked).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  }, 60000);

  it('width 520 (narrow pane, wrap-heavy)', async () => {
    const { mismatches, rowsChecked } = await sweep({ width: 520, seed: 3 });
    // eslint-disable-next-line no-console
    console.log(
      `[520] rowsChecked=${rowsChecked} mismatches=${JSON.stringify(mismatches, null, 1)}`
    );
    expect(rowsChecked).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  }, 60000);

  it('width 880, rich prose (headings, mentions, inline code)', async () => {
    const { mismatches, rowsChecked } = await sweep({ width: 880, richProse: true, seed: 5 });
    // eslint-disable-next-line no-console
    console.log(
      `[rich] rowsChecked=${rowsChecked} mismatches=${JSON.stringify(mismatches, null, 1)}`
    );
    expect(rowsChecked).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  }, 60000);

  it('adversarial text: emoji/CJK/RTL/unbreakable tokens at two widths', async () => {
    for (const width of [880, 430]) {
      const { mismatches, rowsChecked } = await sweep({ width, turns: adversarialTurns() });
      // eslint-disable-next-line no-console
      console.log(
        `[adv ${width}] rowsChecked=${rowsChecked} mismatches=${JSON.stringify(mismatches, null, 1)}`
      );
      expect(rowsChecked).toBeGreaterThan(4);
      expect(mismatches).toEqual([]);
    }
  }, 60000);

  it('streaming: reserved height tracks rendered height while markdown structure evolves', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:880px;height:600px;overflow:hidden;position:relative;';
    document.body.appendChild(host);
    const ctx = createChatContext({ theme: DEFAULT_THEME });
    const state = createChatState(ctx);
    state.transcript.history.seed(generateMockTranscript(16, 1));
    const dispose = render(() => <ChatRoot context={ctx} state={state} debug />, host);

    const mismatchLog: Mismatch[] = [];
    try {
      await sleep(500);
      // Stream a message whose block structure keeps changing: paragraph →
      // list → open code fence (unterminated!) → more code → close fence →
      // table → long emoji/CJK tail.
      const CHUNKS = [
        'Starting a paragraph with some text ',
        'that keeps growing.\n\n- list item one\n- list item ',
        'two\n- item three\n\n```ts\nconst x = 1;\n',
        'function foo() {\n  return 42;\n}\n',
        '```\n\n| col a | col b |\n| --- | --- |\n| 1 ',
        '| 2 |\n\nTail with emoji 🧑‍💻🚀 and CJK 中文字符 ',
        'and a long unbreakable https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa token end.',
      ];
      let text = '';
      for (let i = 0; i < CHUNKS.length; i++) {
        text += CHUNKS[i];
        state.transcript.activeTurn.set(
          {
            id: 'turn-stream',
            seq: 16,
            initiator: 'agent',
            items: [
              { kind: 'message', id: 'm-stream', seq: 0, role: 'assistant', text } as TurnItem,
            ],
          },
          'generating'
        );
        // Sample mismatches over a few frames at each structural stage.
        await sleep(150);
        for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
          const bad = el.querySelector(`.${debugMismatch}`);
          if (bad) {
            mismatchLog.push({
              index: (el as HTMLElement).dataset.index!,
              text: `stage ${i}: ${bad.textContent ?? ''}`,
              scrollTop: 0,
            });
          }
        }
      }
      state.transcript.activeTurn.commit();
      await sleep(300);
      for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
        const bad = el.querySelector(`.${debugMismatch}`);
        if (bad) {
          mismatchLog.push({
            index: (el as HTMLElement).dataset.index!,
            text: `post-commit: ${bad.textContent ?? ''}`,
            scrollTop: 0,
          });
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[stream] mismatches=${JSON.stringify(mismatchLog, null, 1)}`);
      expect(mismatchLog).toEqual([]);
    } finally {
      dispose();
      state.dispose();
      ctx.dispose();
      host.remove();
    }
  }, 60000);
});
