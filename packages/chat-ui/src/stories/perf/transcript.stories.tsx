/**
 * Perf stories — scroll performance profiling for the chat-ui renderer.
 *
 * Open each story, wait for the transcript to render, then the sweep runs
 * automatically and prints results to the browser console as a console.table.
 *
 * Metrics:
 *   • Frame-time (avg / p50 / p95 / max ms) — lower is better
 *   • DOM node churn (total nodes added/removed by MutationObserver) — 0 after warmup is ideal
 *   • Row-component creations during the sweep — grows with rows scrolled past (one
 *     create/dispose per row entering/leaving the <For> window)
 */

import { createEffect, createSignal, onMount } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatRoot } from '../../ChatRoot';
import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import { generateMockTranscript } from '../../mock-transcript';
import { createTranscript } from '../../state/transcript';
import { createViewState } from '../../state/view-state';
import { resetRowCreations, runPerfSweep } from '../perf-instrument';

const meta: Meta = {
  title: 'Perf/Transcript',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

function PerfHost(props: { count: number; label: string; height?: number }) {
  const transcript = createTranscript();
  const viewState = createViewState();

  createEffect(() => {
    transcript.seed(generateMockTranscript(props.count));
  });

  let scrollEl: HTMLDivElement | undefined;
  const [result, setResult] = createSignal<string>('Running sweep…');

  onMount(() => {
    // Give the transcript a frame to mount before sweeping.
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (!scrollEl) return;
        const sc = scrollEl.querySelector('[data-chat-scroll]') as HTMLElement | null;
        if (!sc) {
          setResult('Could not find scroll container');
          return;
        }
        resetRowCreations();
        const r = await runPerfSweep(props.label, sc, 3000);
        const summary = [
          `=== ${props.label} ===`,
          `Frames: ${r.frames.count}  avg:${r.frames.avgMs}ms  p50:${r.frames.p50Ms}ms  p95:${r.frames.p95Ms}ms  max:${r.frames.maxMs}ms`,
          `Churn: ${r.churn.totalNodes} nodes in ${r.churn.totalMutations} mutations (avg ${r.churn.avgNodesPerMutation}/mut)`,
          `Row creations during sweep: ${r.rowCreationsDuringRun}`,
        ].join('\n');
        console.log(summary);
        console.table({
          'avg frame ms': r.frames.avgMs,
          'p50 frame ms': r.frames.p50Ms,
          'p95 frame ms': r.frames.p95Ms,
          'max frame ms': r.frames.maxMs,
          'churn nodes': r.churn.totalNodes,
          'churn mutations': r.churn.totalMutations,
          'row creations': r.rowCreationsDuringRun,
        });
        setResult(summary);
      });
    });
  });

  return (
    <div>
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        style={{
          width: '640px',
          height: `${props.height ?? 700}px`,
          border: '1px solid #e2e8f0',
          'border-radius': '8px',
          overflow: 'hidden',
        }}
      >
        <ChatRoot transcript={transcript} viewState={viewState} fonts={DEFAULT_FONT_CONFIG} />
      </div>
      <pre
        style={{
          'margin-top': '12px',
          padding: '12px',
          background: '#f1f5f9',
          'border-radius': '6px',
          'font-size': '12px',
          'white-space': 'pre-wrap',
          'word-break': 'break-all',
        }}
      >
        {result()}
      </pre>
    </div>
  );
}

export const TenK: Story = {
  name: '10k scroll sweep',
  render: () => <PerfHost count={10000} label="10k rows" />,
};

export const TwoK: Story = {
  name: '2k scroll sweep',
  render: () => <PerfHost count={2000} label="2k rows" />,
};
