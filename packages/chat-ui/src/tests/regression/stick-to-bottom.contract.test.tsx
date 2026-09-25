/**
 * Regression suite: stick-to-bottom behavior in ChatRoot.
 *
 * Guards the tail pin during sustained streaming, composer (padBottom) growth,
 * and viewport resize, and asserts the pin is NOT restored after the user
 * scrolls away mid-stream. Covers the derived-invalidation bridge in ChatRoot
 * and intent derivation in core/scroll-projection.ts.
 *
 * Run:
 *   cd packages/chat-ui
 *   pnpm exec vitest run --project browser src/tests/regression/stick-to-bottom.contract.test.tsx
 */

import { DEFAULT_THEME } from '@core/theme';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { ChatRoot } from '@/ChatRoot';
import type { TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

type TurnItem = TranscriptTurn['items'][number];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeTurns(n: number, seed = 42): TranscriptTurn[] {
  const rng = makeRng(seed);
  const turns: TranscriptTurn[] = [];
  for (let i = 0; i < n; i++) {
    const item = {
      kind: 'message',
      id: `m-${i}`,
      seq: i,
      role: i % 4 === 0 ? 'user' : 'assistant',
      text: `**msg ${i}** — ${makeText(rng, 5, 120)}`,
    } as TurnItem;
    turns.push({
      id: `turn-${i}`,
      seq: i,
      initiator: i % 4 === 0 ? 'user' : 'agent',
      items: [item],
    });
  }
  return turns;
}

type MountResult = {
  host: HTMLElement;
  scrollEl: HTMLElement;
  state: ReturnType<typeof createChatState>;
  setPadBottom: (px: number) => void;
  dispose: () => void;
};

function mountChat(
  turns: TranscriptTurn[],
  opts: { width?: number; height?: number } = {}
): MountResult {
  const width = opts.width ?? 880;
  const height = opts.height ?? 600;
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.overflow = 'hidden';
  host.style.position = 'relative';
  document.body.appendChild(host);

  const ctx = createChatContext({ theme: DEFAULT_THEME });
  const state = createChatState(ctx);
  state.transcript.history.seed(turns);

  const [padBottom, setPadBottom] = createSignal(0);
  const disposeRender = render(
    () => <ChatRoot context={ctx} state={state} padBottom={padBottom} />,
    host
  );
  const scrollEl = host.querySelector('[data-chat-scroll]') as HTMLElement;

  return {
    host,
    scrollEl,
    state,
    setPadBottom,
    dispose: () => {
      disposeRender();
      state.dispose();
      ctx.dispose();
      host.remove();
    },
  };
}

/** Distance from the bottom of the scrollable content, in px. */
const distToBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop;

type BottomSample = { t: number; dist: number; scrollTop: number };

/** Sample distance-to-bottom every frame for durationMs. */
async function sampleBottomDistance(el: HTMLElement, durationMs: number): Promise<BottomSample[]> {
  const t0 = performance.now();
  const out: BottomSample[] = [];
  while (performance.now() - t0 < durationMs) {
    await nextFrame();
    out.push({ t: performance.now() - t0, dist: distToBottom(el), scrollTop: el.scrollTop });
  }
  return out;
}

function summarize(samples: BottomSample[]): string {
  const lines: string[] = [];
  let prev: BottomSample | null = null;
  for (const s of samples) {
    if (!prev || Math.abs(s.dist - prev.dist) > 4) {
      lines.push(
        `t=${s.t.toFixed(0)}ms dist=${s.dist.toFixed(1)} scrollTop=${s.scrollTop.toFixed(1)}`
      );
      prev = s;
    }
  }
  return lines.join('\n');
}

/** Stream chunks into the active turn every `tickMs` for `ticks` ticks. */
async function streamActiveTurn(
  state: ReturnType<typeof createChatState>,
  opts: { ticks: number; tickMs: number; seq: number; seed?: number }
): Promise<void> {
  const rng = makeRng(opts.seed ?? 99);
  let text = '';
  for (let tick = 0; tick < opts.ticks; tick++) {
    text += ` ${makeText(rng, 10, 25)}`;
    state.transcript.activeTurn.set(
      {
        id: 'turn-active',
        seq: opts.seq,
        initiator: 'agent',
        items: [{ kind: 'message', id: 'm-active', seq: 0, role: 'assistant', text } as TurnItem],
      },
      'generating'
    );
    await sleep(opts.tickMs);
  }
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

describe('stick-to-bottom regression', () => {
  it('A. stays pinned to the bottom during sustained streaming', async () => {
    const m = mountChat(makeTurns(40));
    try {
      await sleep(400); // initial tail projection settles

      const streaming = streamActiveTurn(m.state, { ticks: 60, tickMs: 25, seq: 40 });
      const samples = await sampleBottomDistance(m.scrollEl, 60 * 25 + 300);
      await streaming;

      // Transient lag of a couple frames is fine; sustained detachment is not.
      // Count frames where we are more than 100px off the bottom.
      const detached = samples.filter((s) => s.dist > 100);
      const maxDist = Math.max(...samples.map((s) => s.dist));
      const finalDist = samples[samples.length - 1]!.dist;
      // eslint-disable-next-line no-console
      console.log(
        `[A] maxDist=${maxDist.toFixed(1)} finalDist=${finalDist.toFixed(1)} detachedFrames=${detached.length}/${samples.length}\n${summarize(samples)}`
      );
      expect(finalDist).toBeLessThanOrEqual(48);
      expect(detached.length).toBeLessThanOrEqual(3);
    } finally {
      m.dispose();
    }
  });

  it('B. re-pins when the composer (padBottom) grows while idle at the tail', async () => {
    const m = mountChat(makeTurns(40, 7));
    try {
      await sleep(400);
      expect(distToBottom(m.scrollEl)).toBeLessThanOrEqual(2);

      // Composer grows by 160px (e.g. multiline draft) with NO streaming.
      m.setPadBottom(160);
      await sleep(400); // plenty of frames to react

      const dist = distToBottom(m.scrollEl);
      // eslint-disable-next-line no-console
      console.log(`[B] dist after padBottom growth = ${dist.toFixed(1)}px`);
      // Pinned means the last content sits above the composer: scrollTop == new max.
      expect(dist).toBeLessThanOrEqual(2);
    } finally {
      m.dispose();
    }
  });

  it('C. re-pins when the viewport shrinks while idle at the tail', async () => {
    const m = mountChat(makeTurns(40, 11));
    try {
      await sleep(400);
      expect(distToBottom(m.scrollEl)).toBeLessThanOrEqual(2);

      // Window/pane shrinks by 200px.
      m.host.style.height = '400px';
      await sleep(400);

      const dist = distToBottom(m.scrollEl);
      // eslint-disable-next-line no-console
      console.log(`[C] dist after viewport shrink = ${dist.toFixed(1)}px`);
      expect(dist).toBeLessThanOrEqual(2);
    } finally {
      m.dispose();
    }
  });

  it('D. does not snap back to the bottom after the user scrolls away mid-stream', async () => {
    const m = mountChat(makeTurns(40, 13));
    try {
      await sleep(400);

      const streaming = streamActiveTurn(m.state, { ticks: 80, tickMs: 25, seq: 40, seed: 5 });
      await sleep(300); // let a few chunks land while pinned

      // User wheels up 5 × 160px to read something above.
      for (let i = 0; i < 5; i++) {
        m.scrollEl.scrollTop = Math.max(0, m.scrollEl.scrollTop - 160);
        await sleep(40);
      }

      // Observe the rest of the stream: distance to bottom must KEEP GROWING
      // (content streams in below) — never collapse back under the threshold.
      const samples = await sampleBottomDistance(m.scrollEl, 1400);
      await streaming;

      const minDist = Math.min(...samples.map((s) => s.dist));
      const finalDist = samples[samples.length - 1]!.dist;
      // eslint-disable-next-line no-console
      console.log(
        `[D] minDist=${minDist.toFixed(1)} finalDist=${finalDist.toFixed(1)}\n${summarize(samples)}`
      );
      // We scrolled ~800px up; if the engine ever brings us within the 48px
      // stick threshold again, it re-pinned against the user's intent.
      expect(minDist).toBeGreaterThan(100);
    } finally {
      m.dispose();
    }
  });
});
