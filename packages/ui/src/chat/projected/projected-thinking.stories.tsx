/**
 * Chat/Projected/Thinking — stories for the Thinking row.
 *
 * Scenarios:
 *  - ThinkingActive      live-streaming tokens + duration ticker
 *  - TransitionToDone    streams for a few seconds then flips to done (collapsed)
 *  - DoneCollapsed       static done row in collapsed state
 *  - DoneExpanded        static done row in expanded state
 *  - InMixedTranscript   thinking row surrounded by user/assistant messages
 */

import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'mobx';
import React, { useEffect, useRef } from 'react';
import type { ChatItem } from '../model';
import { TranscriptStore } from '../state/transcript-store';
import { ViewStateStore } from '../state/view-state-store';
import { LayoutStore } from './layout/layout-store';
import { ProjectedTranscript } from './view/projected-transcript';
import './projected.module.css';

// ── Sample reasoning text ─────────────────────────────────────────────────────

const REASONING_TOKENS = [
  'Let me think through this carefully.\n',
  'First, I need to understand the problem domain.\n',
  'The key constraint is that we must preserve O(log n) update complexity.\n',
  'A Fenwick tree would be ideal here.\n',
  'We can use binary-indexed trees to sum prefix heights efficiently.\n',
  'The virtualizer needs two operations: point-update and prefix-sum.\n',
  'Let me sketch the implementation:\n\n',
  '```\nfunction update(i, delta) {\n',
  '  for (i++; i <= n; i += i & -i)\n',
  '    tree[i] += delta;\n}\n```\n\n',
  'For the range query we do:\n\n',
  '```\nfunction query(i) {\n',
  '  let s = 0;\n',
  '  for (i++; i > 0; i -= i & -i)\n',
  '    s += tree[i];\n  return s;\n}\n```\n\n',
  'Now for scroll position we binary-search the prefix-sum tree.\n',
  'This gives us O(log n) for both updates and scroll-to-row.\n',
  'The virtualizer should store heights relative to their initial estimates.\n',
  'Correction is applied as a delta so we never need to rebuild the tree.\n',
  'This approach is similar to what Virtua uses internally.\n',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Scaffold a TranscriptStore + ViewStateStore + LayoutStore, run a setup
 * callback, and render a ProjectedTranscript.
 */
function ScriptedChat({
  setup,
  height = 480,
  width = 640,
}: {
  setup: (
    transcript: TranscriptStore,
    viewState: ViewStateStore,
    schedule: (ms: number, fn: () => void) => void
  ) => (() => void) | void;
  height?: number;
  width?: number;
}): React.ReactElement {
  const transcriptRef = useRef<TranscriptStore | null>(null);
  const viewStateRef = useRef<ViewStateStore | null>(null);
  const layoutRef = useRef<LayoutStore | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  if (!transcriptRef.current) transcriptRef.current = new TranscriptStore();
  if (!viewStateRef.current) viewStateRef.current = new ViewStateStore();
  if (!layoutRef.current) layoutRef.current = new LayoutStore();

  const transcript = transcriptRef.current;
  const viewState = viewStateRef.current;

  useEffect(() => {
    const timers = timersRef.current;

    function schedule(ms: number, fn: () => void) {
      timers.push(setTimeout(fn, ms));
    }

    const cleanup = setup(transcript, viewState, schedule);

    return () => {
      if (typeof cleanup === 'function') cleanup();
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      transcript.reset();
    };
    // Intentionally run once on mount — stores are refs, setup is a stable closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width, height, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <ProjectedTranscript
        store={transcript}
        viewState={viewState}
        layoutStore={layoutRef.current ?? undefined}
      />
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Chat/Projected/Thinking',
  component: ScriptedChat,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof ScriptedChat>;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * ThinkingActive — tokens stream in every 200ms, duration label ticks every second.
 * The row never transitions to done; stays active indefinitely.
 */
export const ThinkingActive: Story = {
  name: 'Thinking / Active',
  render: () => (
    <ScriptedChat
      setup={action((transcript, _viewState, schedule) => {
        const id = 'think-active-1';
        transcript.upsertThinking({ id, startedAt: Date.now() });

        let tokenIdx = 0;
        let accumulated = '';

        function appendNextToken() {
          if (tokenIdx >= REASONING_TOKENS.length) {
            tokenIdx = 0; // loop
          }
          accumulated += REASONING_TOKENS[tokenIdx++];
          transcript.upsertThinking({ id, text: accumulated });
          schedule(220, appendNextToken);
        }
        schedule(200, appendNextToken);
      })}
    />
  ),
};

/**
 * TransitionToDone — streams for ~3 s then transitions to done (collapsed by default).
 * Click the header to expand/collapse.
 */
export const TransitionToDone: Story = {
  name: 'Thinking / Transition to Done',
  render: () => (
    <ScriptedChat
      setup={action((transcript, _viewState, schedule) => {
        const id = 'think-transition-1';
        const startedAt = Date.now();
        transcript.upsertThinking({ id, startedAt });

        let tokenIdx = 0;
        let accumulated = '';

        function appendNextToken() {
          if (tokenIdx >= REASONING_TOKENS.length) {
            // All tokens streamed — finalize
            const durationMs = Date.now() - startedAt;
            transcript.upsertThinking({ id, text: accumulated, status: 'done', durationMs });
            return;
          }
          accumulated += REASONING_TOKENS[tokenIdx++];
          transcript.upsertThinking({ id, text: accumulated });
          schedule(200, appendNextToken);
        }
        schedule(200, appendNextToken);
      })}
    />
  ),
};

/**
 * DoneCollapsed — static done row; collapsed by default.
 * Click the header to expand.
 */
export const DoneCollapsed: Story = {
  name: 'Thinking / Done Collapsed',
  render: () => (
    <ScriptedChat
      setup={action((transcript, viewState, _schedule) => {
        const id = 'think-done-collapsed-1';
        const startedAt = Date.now() - 4800;
        transcript.seed([
          {
            kind: 'thinking',
            id,
            status: 'done',
            text: REASONING_TOKENS.join(''),
            startedAt,
            durationMs: 4800,
          },
        ]);
        // Seed collapsed state to simulate the engine-transition default.
        viewState.setCollapsed(id, true);
      })}
    />
  ),
};

/**
 * DoneExpanded — static done row, pre-expanded.
 * Click the header to collapse.
 */
export const DoneExpanded: Story = {
  name: 'Thinking / Done Expanded',
  render: () => (
    <ScriptedChat
      setup={action((transcript, _viewState, _schedule) => {
        const id = 'think-done-expanded-1';
        const startedAt = Date.now() - 6200;
        transcript.seed([
          {
            kind: 'thinking',
            id,
            status: 'done',
            text: REASONING_TOKENS.join(''),
            startedAt,
            durationMs: 6200,
          },
        ]);
        // Not seeded collapsed → expanded by default (viewState default is expanded).
      })}
    />
  ),
};

/**
 * InMixedTranscript — a thinking row sandwiched between user/assistant messages.
 */
export const InMixedTranscript: Story = {
  name: 'Thinking / In Mixed Transcript',
  render: () => {
    const items: ChatItem[] = [
      {
        kind: 'message',
        id: 'msg-1',
        role: 'user',
        text: 'Can you help me implement a Fenwick tree virtualizer?',
      },
      {
        kind: 'thinking',
        id: 'think-mixed-1',
        status: 'done',
        text: REASONING_TOKENS.join(''),
        startedAt: Date.now() - 5000,
        durationMs: 5000,
      },
      {
        kind: 'message',
        id: 'msg-2',
        role: 'assistant',
        text: [
          "Sure! Here's the plan:\n",
          '1. Implement a **Fenwick tree** for prefix-sum height queries.\n',
          '2. Use binary search to map `scrollTop → row index`.\n',
          '3. Track height deltas via `setSize(i, newH)` — O(log n).\n',
          '\nThis avoids a full tree rebuild on each height update.',
        ].join(''),
      },
    ];

    return (
      <ScriptedChat
        setup={action((transcript, viewState, _schedule) => {
          transcript.seed(items);
          // Collapse the thinking row by default (as the engine would).
          viewState.setCollapsed('think-mixed-1', true);
        })}
        height={520}
      />
    );
  },
};
