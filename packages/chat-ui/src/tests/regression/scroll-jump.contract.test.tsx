/**
 * Regression suite: scroll-position stability in ChatRoot.
 *
 * Guards against content shifting under the viewport while off-screen row
 * heights settle from estimate to exact, during streaming, and across scroll
 * gestures. Covers same-frame height compensation in core/scroll-projection.ts.
 *
 * Run:
 *   cd packages/chat-ui
 *   pnpm exec vitest run --project browser src/tests/regression/scroll-jump.contract.test.tsx
 */

import { DEFAULT_THEME } from '@core/theme';
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

/** Deterministic LCG so runs are reproducible. */
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

/** N committed turns, each one assistant message of wildly varying length. */
function makeTurns(n: number, seed = 42): TranscriptTurn[] {
  const rng = makeRng(seed);
  const turns: TranscriptTurn[] = [];
  for (let i = 0; i < n; i++) {
    const item = {
      kind: 'message',
      id: `m-${i}`,
      seq: i,
      role: i % 4 === 0 ? 'user' : 'assistant',
      text: `**msg ${i}** — ${makeText(rng, 5, 220)}`,
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

  const disposeRender = render(() => <ChatRoot context={ctx} state={state} />, host);
  const scrollEl = host.querySelector('[data-chat-scroll]') as HTMLElement;

  return {
    host,
    scrollEl,
    state,
    dispose: () => {
      disposeRender();
      state.dispose();
      ctx.dispose();
      host.remove();
    },
  };
}

/** Snapshot viewport tops of all row wrappers currently intersecting the viewport. */
function captureVisibleTops(host: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>();
  const hostRect = host.getBoundingClientRect();
  for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
    const r = el.getBoundingClientRect();
    if (r.bottom > hostRect.top && r.top < hostRect.bottom) {
      tops.set((el as HTMLElement).dataset.index!, r.top);
    }
  }
  return tops;
}

type DriftSample = { t: number; index: string; drift: number };

type FrameLog = {
  t: number;
  scrollTop: number;
  /** max drift across tracked rows this frame */
  drift: number;
};

/**
 * Observe drift of the captured rows over `durationMs`, sampling every frame.
 * `expectedShift(t)` is the viewport-top shift we *expect* from our own
 * scrolling (0 when we are not scrolling). Also logs scrollTop per frame so a
 * drift event can be classified as "heights moved under constant scrollTop"
 * vs "scrollTop was rewritten".
 */
async function observeDrift(
  host: HTMLElement,
  scrollEl: HTMLElement,
  baseline: Map<string, number>,
  durationMs: number,
  expectedShift: () => number = () => 0
): Promise<{
  maxAbsDrift: number;
  worst: DriftSample | null;
  samples: DriftSample[];
  frames: FrameLog[];
  finalDrift: number;
}> {
  const t0 = performance.now();
  let maxAbsDrift = 0;
  let worst: DriftSample | null = null;
  const samples: DriftSample[] = [];
  const frames: FrameLog[] = [];
  let finalDrift = 0;
  while (performance.now() - t0 < durationMs) {
    await nextFrame();
    const shift = expectedShift();
    let frameMax = 0;
    for (const el of Array.from(host.querySelectorAll('[data-index]'))) {
      const idx = (el as HTMLElement).dataset.index!;
      const base = baseline.get(idx);
      if (base === undefined) continue;
      const drift = el.getBoundingClientRect().top - base - shift;
      const abs = Math.abs(drift);
      if (abs > 0.5) samples.push({ t: performance.now() - t0, index: idx, drift });
      if (abs > Math.abs(frameMax)) frameMax = drift;
      if (abs > maxAbsDrift) {
        maxAbsDrift = abs;
        worst = { t: performance.now() - t0, index: idx, drift };
      }
    }
    frames.push({ t: performance.now() - t0, scrollTop: scrollEl.scrollTop, drift: frameMax });
    finalDrift = frameMax;
  }
  return { maxAbsDrift, worst, samples, frames, finalDrift };
}

/** Compact frame timeline for console diagnosis: only frames where something changed. */
function summarizeFrames(frames: FrameLog[]): string {
  const lines: string[] = [];
  let prev: FrameLog | null = null;
  for (const f of frames) {
    if (
      !prev ||
      Math.abs(f.drift - prev.drift) > 0.5 ||
      Math.abs(f.scrollTop - prev.scrollTop) > 0.5
    ) {
      lines.push(
        `t=${f.t.toFixed(0)}ms scrollTop=${f.scrollTop.toFixed(1)} drift=${f.drift.toFixed(1)}`
      );
      prev = f;
    }
  }
  return lines.join('\n');
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

describe('scroll-jump regression', () => {
  it('A. rows visible after a jump-scroll stay put while off-screen heights settle', async () => {
    const m = mountChat(makeTurns(250));
    try {
      // Let initial mount + tail projection settle.
      await sleep(400);

      // User jump-scrolls to ~40% — rows above/below are estimates only.
      const maxScroll = m.scrollEl.scrollHeight - m.scrollEl.clientHeight;
      m.scrollEl.scrollTop = Math.floor(maxScroll * 0.4);

      // Wait past SCROLL_SETTLE_MS so the anchor is set and projection ran.
      await sleep(400);

      const baseline = captureVisibleTops(m.host);
      expect(baseline.size).toBeGreaterThan(0);

      // Idle prefetch now settles estimates above/below to exact heights.
      const { maxAbsDrift, worst, samples } = await observeDrift(
        m.host,
        m.scrollEl,
        baseline,
        2000
      );
      // eslint-disable-next-line no-console
      console.log(
        `[A] maxAbsDrift=${maxAbsDrift.toFixed(2)}px worst=${JSON.stringify(worst)} driftingSamples=${samples.length}`
      );
      expect(maxAbsDrift).toBeLessThanOrEqual(1);
    } finally {
      m.dispose();
    }
  });

  it('B. content does not shift under a multi-step upward wheel gesture', async () => {
    const m = mountChat(makeTurns(250, 1337));
    try {
      await sleep(400);
      const maxScroll = m.scrollEl.scrollHeight - m.scrollEl.clientHeight;
      m.scrollEl.scrollTop = Math.floor(maxScroll * 0.7);
      await sleep(400);

      // Track cumulative scroll we perform ourselves; content should shift by
      // exactly -delta (viewport-top increases as we scroll up).
      let selfScrolled = 0;
      const baseline = captureVisibleTops(m.host);
      expect(baseline.size).toBeGreaterThan(0);

      const gesture = (async () => {
        // 12 wheel steps of -240px, ~40ms apart — a fast upward scroll.
        for (let i = 0; i < 12; i++) {
          const before = m.scrollEl.scrollTop;
          m.scrollEl.scrollTop = Math.max(0, before - 240);
          selfScrolled += m.scrollEl.scrollTop - before;
          await sleep(40);
        }
      })();

      const observation = observeDrift(
        m.host,
        m.scrollEl,
        baseline,
        12 * 40 + 600,
        () => -selfScrolled
      );
      await gesture;
      const { maxAbsDrift, worst, samples, frames, finalDrift } = await observation;
      // eslint-disable-next-line no-console
      console.log(
        `[B] maxAbsDrift=${maxAbsDrift.toFixed(2)}px finalDrift=${finalDrift.toFixed(2)}px worst=${JSON.stringify(worst)} driftingSamples=${samples.length}\n${summarizeFrames(frames)}`
      );
      // Allow 2px slop for sub-pixel accumulation across 12 steps.
      expect(maxAbsDrift).toBeLessThanOrEqual(2);
    } finally {
      m.dispose();
    }
  });

  it('C. streaming into the active turn does not move rows the reader is anchored on', async () => {
    const turns = makeTurns(120, 7);
    const m = mountChat(turns);
    try {
      await sleep(400);

      // Reader scrolls up to ~30% to read history.
      const maxScroll = m.scrollEl.scrollHeight - m.scrollEl.clientHeight;
      m.scrollEl.scrollTop = Math.floor(maxScroll * 0.3);
      await sleep(400);

      const baseline = captureVisibleTops(m.host);
      expect(baseline.size).toBeGreaterThan(0);

      // Agent streams a response at the tail (below the viewport).
      const rng = makeRng(99);
      const streaming = (async () => {
        let text = '';
        for (let tick = 0; tick < 40; tick++) {
          text += ` ${makeText(rng, 8, 16)}`;
          m.state.transcript.activeTurn.set(
            {
              id: 'turn-active',
              seq: 120,
              initiator: 'agent',
              items: [
                { kind: 'message', id: 'm-active', seq: 0, role: 'assistant', text } as TurnItem,
              ],
            },
            'generating'
          );
          await sleep(30);
        }
      })();

      const observation = observeDrift(m.host, m.scrollEl, baseline, 40 * 30 + 500);
      await streaming;
      const { maxAbsDrift, worst, samples } = await observation;
      // eslint-disable-next-line no-console
      console.log(
        `[C] maxAbsDrift=${maxAbsDrift.toFixed(2)}px worst=${JSON.stringify(worst)} driftingSamples=${samples.length}`
      );
      expect(maxAbsDrift).toBeLessThanOrEqual(1);
    } finally {
      m.dispose();
    }
  });

  it('D. minimal: a single upward wheel step does not shift content', async () => {
    const m = mountChat(makeTurns(250, 2024));
    try {
      await sleep(400);
      const maxScroll = m.scrollEl.scrollHeight - m.scrollEl.clientHeight;
      m.scrollEl.scrollTop = Math.floor(maxScroll * 0.7);
      await sleep(400);

      let selfScrolled = 0;
      const baseline = captureVisibleTops(m.host);
      expect(baseline.size).toBeGreaterThan(0);

      const observation = observeDrift(m.host, m.scrollEl, baseline, 800, () => -selfScrolled);
      // One fast flick up, shortly after observation starts. 1200px reaches
      // beyond the idle-prefetch zone (PREFETCH_BEHIND=20 rows) so freshly
      // mounted rows above still carry estimated heights.
      await sleep(50);
      const before = m.scrollEl.scrollTop;
      m.scrollEl.scrollTop = before - 1200;
      selfScrolled += m.scrollEl.scrollTop - before;

      const { maxAbsDrift, worst, samples, frames, finalDrift } = await observation;
      // eslint-disable-next-line no-console
      console.log(
        `[D] maxAbsDrift=${maxAbsDrift.toFixed(2)}px finalDrift=${finalDrift.toFixed(2)}px worst=${JSON.stringify(worst)} driftingSamples=${samples.length}\n${summarizeFrames(frames)}`
      );
      expect(maxAbsDrift).toBeLessThanOrEqual(1);
    } finally {
      m.dispose();
    }
  });
});
