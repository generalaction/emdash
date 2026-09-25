/**
 * Regression suite: history pagination (loadOlder) in ChatRoot.
 *
 * Exercises the history-prepend path end-to-end: viewport anchor stability
 * across loadOlder, prepend while pinned at the streaming tail, and dedupe of
 * duplicate page delivery. Covers mode-aware prepend compensation in
 * core/scroll-projection.ts and turn-id dedupe in doLoadOlder/history.prepend.
 *
 * Run:
 *   cd packages/chat-ui
 *   pnpm exec vitest run --project browser src/tests/regression/pagination.contract.test.tsx
 */

import { DEFAULT_THEME } from '@core/theme';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { ChatRoot, type EngineControls } from '@/ChatRoot';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

type TurnItem = TranscriptTurn['items'][number];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const WORDS =
  'the quick brown fox jumps over a lazy dog while measuring glyph widths off screen and computing wrapped line heights for the virtualizer'.split(
    ' '
  );

function makeText(rng: () => number, minWords: number, maxWords: number): string {
  const n = minWords + Math.floor(rng() * (maxWords - minWords));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rng() * WORDS.length)]!);
  return out.join(' ');
}

/** Turns with seq in [seqStart, seqStart+n). */
function makeTurns(n: number, seqStart: number, seed = 42): TranscriptTurn[] {
  const rng = makeRng(seed + seqStart);
  const turns: TranscriptTurn[] = [];
  for (let i = 0; i < n; i++) {
    const seq = seqStart + i;
    const item = {
      kind: 'message',
      id: `m-${seq}`,
      seq,
      role: seq % 4 === 0 ? 'user' : 'assistant',
      text: `**msg ${seq}** — ${makeText(rng, 5, 120)}`,
    } as TurnItem;
    turns.push({
      id: `turn-${seq}`,
      seq,
      initiator: seq % 4 === 0 ? 'user' : 'agent',
      items: [item],
    });
  }
  return turns;
}

type Mounted = {
  host: HTMLElement;
  scrollEl: HTMLElement;
  state: ReturnType<typeof createChatState>;
  controls: EngineControls;
  dispose: () => void;
};

function mountChat(turns: TranscriptTurn[]): Mounted {
  const host = document.createElement('div');
  host.style.cssText = 'width:880px;height:600px;overflow:hidden;position:relative;';
  document.body.appendChild(host);
  const ctx = createChatContext({ theme: DEFAULT_THEME });
  const state = createChatState(ctx);
  state.transcript.history.seed(turns);
  const controls = {} as EngineControls;
  const dispose = render(() => <ChatRoot context={ctx} state={state} controls={controls} />, host);
  const scrollEl = host.querySelector('[data-chat-scroll]') as HTMLElement;
  return {
    host,
    scrollEl,
    state,
    controls,
    dispose: () => {
      dispose();
      state.dispose();
      ctx.dispose();
      host.remove();
    },
  };
}

/** First visible row text marker + viewport top, to identify content the user sees. */
function captureViewportRows(host: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>();
  const hostRect = host.getBoundingClientRect();
  for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
    const r = el.getBoundingClientRect();
    if (r.bottom > hostRect.top && r.top < hostRect.bottom) {
      // Key by content marker (msg id in the bold prefix), not data-index —
      // prepend shifts indexes by design.
      const marker = (el.textContent ?? '').slice(0, 24);
      tops.set(marker, r.top);
    }
  }
  return tops;
}

async function observeContentDrift(
  host: HTMLElement,
  baseline: Map<string, number>,
  durationMs: number
): Promise<{ maxAbsDrift: number; timeline: string[] }> {
  const t0 = performance.now();
  let maxAbsDrift = 0;
  const timeline: string[] = [];
  let prevWorst = 0;
  while (performance.now() - t0 < durationMs) {
    await nextFrame();
    let worst = 0;
    for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
      const marker = (el.textContent ?? '').slice(0, 24);
      const base = baseline.get(marker);
      if (base === undefined) continue;
      const d = el.getBoundingClientRect().top - base;
      if (Math.abs(d) > Math.abs(worst)) worst = d;
    }
    if (Math.abs(worst - prevWorst) > 0.5) {
      timeline.push(`t=${(performance.now() - t0).toFixed(0)}ms drift=${worst.toFixed(1)}`);
      prevWorst = worst;
    }
    maxAbsDrift = Math.max(maxAbsDrift, Math.abs(worst));
  }
  return { maxAbsDrift, timeline };
}

const distToBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop;

describe('pagination regression', () => {
  it('A. loadOlder keeps the rows the user is reading fixed in the viewport', async () => {
    const m = mountChat(makeTurns(60, 100));
    try {
      await sleep(500);
      // User scrolls up to near the top (where "load older" would trigger).
      m.scrollEl.scrollTop = 300;
      await sleep(400);

      const baseline = captureViewportRows(m.host);
      expect(baseline.size).toBeGreaterThan(0);

      m.controls.loadOlder(makeTurns(40, 0));

      const { maxAbsDrift, timeline } = await observeContentDrift(m.host, baseline, 1500);
      // eslint-disable-next-line no-console
      console.log(`[A] maxAbsDrift=${maxAbsDrift.toFixed(1)}\n${timeline.join('\n')}`);
      expect(maxAbsDrift).toBeLessThanOrEqual(2);
    } finally {
      m.dispose();
    }
  }, 30000);

  it('B. loadOlder while pinned at a streaming tail keeps the pin', async () => {
    const m = mountChat(makeTurns(60, 100, 7));
    try {
      await sleep(500);
      expect(distToBottom(m.scrollEl)).toBeLessThanOrEqual(2);

      // Stream and prepend concurrently.
      const rng = makeRng(1);
      let text = '';
      let worstDist = 0;
      for (let tick = 0; tick < 30; tick++) {
        text += ` ${makeText(rng, 8, 16)}`;
        m.state.transcript.activeTurn.set(
          {
            id: 'turn-active',
            seq: 200,
            initiator: 'agent',
            items: [
              { kind: 'message', id: 'm-active', seq: 0, role: 'assistant', text } as TurnItem,
            ],
          },
          'generating'
        );
        if (tick === 10) m.controls.loadOlder(makeTurns(40, 0, 7));
        await sleep(30);
        worstDist = Math.max(worstDist, distToBottom(m.scrollEl));
        if (tick === 9 || tick === 10 || tick === 11 || tick === 29) {
          // eslint-disable-next-line no-console
          console.log(
            `[B] tick=${tick} mode=${JSON.stringify(m.state.scroll.get())} dist=${distToBottom(m.scrollEl).toFixed(0)} scrollTop=${m.scrollEl.scrollTop.toFixed(0)} scrollHeight=${m.scrollEl.scrollHeight}`
          );
        }
      }
      await sleep(300);
      const finalDist = distToBottom(m.scrollEl);
      // eslint-disable-next-line no-console
      console.log(
        `[B] worstDist=${worstDist.toFixed(1)} finalDist=${finalDist.toFixed(1)} finalMode=${JSON.stringify(m.state.scroll.get())}`
      );
      expect(finalDist).toBeLessThanOrEqual(48);
      // Transient detachment beyond ~2 viewport rows during prepend = jump.
      expect(worstDist).toBeLessThanOrEqual(200);
    } finally {
      m.dispose();
    }
  }, 30000);

  it('C. seam contract: duplicate page delivery is deduped by turn id', async () => {
    const m = mountChat(makeTurns(30, 100, 3));
    try {
      await sleep(400);
      const heightBefore = m.scrollEl.scrollHeight;

      const olderPage = makeTurns(20, 0, 3);
      m.controls.loadOlder(olderPage);
      await sleep(300);
      const heightAfterFirst = m.scrollEl.scrollHeight;

      const turnsAfterFirst = m.state.transcript.state.committedTurns.length;

      // Host retry delivers the SAME page again (network retry, race).
      m.controls.loadOlder([...olderPage]);
      await sleep(300);
      const heightAfterDup = m.scrollEl.scrollHeight;
      const turnsAfterDup = m.state.transcript.state.committedTurns.length;

      const firstPageHeight = heightAfterFirst - heightBefore;
      const dupGrowth = heightAfterDup - heightAfterFirst;
      // eslint-disable-next-line no-console
      console.log(
        `[C] firstPageHeight=${firstPageHeight} dupGrowth=${dupGrowth} (dup accepted = growth ≈ page height)`
      );
      // Duplicate turns must be dropped, not re-rendered as duplicate history.
      expect(turnsAfterDup).toBe(turnsAfterFirst);
      // Height may still drift as estimates settle, but never by ~a page.
      expect(dupGrowth).toBeLessThan(firstPageHeight * 0.5);
    } finally {
      m.dispose();
    }
  }, 30000);
});
