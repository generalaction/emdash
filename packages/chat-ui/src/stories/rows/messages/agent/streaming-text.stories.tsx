/**
 * Streaming text smoothing stories — visualize per-word fade+slide animation
 * and the optional cadence smoother.
 *
 * WordFadeIn    — per-word fade+slide at a steady word cadence (Part A only).
 * BurstyVsSmoothed — same bursty feed rendered twice: raw (left) and smoothed (right).
 * SlowMotion    — slow word cadence so the animation is easy to inspect.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createStreamSmoother } from '@state/stream-smoother';
import { ScriptedChat } from '@/stories/_harness/chat-host';
import { streamMessage } from '@/stories/_harness/streaming/scenario';

const meta: Meta = {
  title: 'Rows/Messages/Agent/StreamingText',
  parameters: { layout: 'centered' },
};
export default meta;

// ── Sample texts ──────────────────────────────────────────────────────────────

const MULTI_PARAGRAPH = `\
Streaming text smoothing adds a per-word **fade + slide-up** animation so that \
newly revealed words appear gracefully rather than popping in all at once.

Each word fades from opacity 0 to 1 and slides up 2 px over 220 ms. Spaces and \
punctuation are preserved verbatim so the layout geometry is identical to the \
non-streaming case — the \`measure() === offsetHeight\` invariant is maintained.

The animation frontier advances after every render cycle, so on the next chunk \
only the freshly appended tail is animated. Words that were already visible on \
the previous render remain static.

> This technique is entirely **paint-only**: no reflow, no layout shift, and \
zero overhead once the message is committed.`;

const BURSTY_TEXT = `\
Bursty network: large chunks arrive at irregular intervals. The raw feed shows \
words popping in batches while the smoothed feed releases one word per tick for \
an even reading cadence.\n\nBoth feeds end with the same complete message.`;

// ── WordFadeIn ────────────────────────────────────────────────────────────────

/**
 * Streams a multi-paragraph assistant message word-by-word at a comfortable
 * reading pace. Demonstrates Part A (per-word fade+slide) in isolation.
 */
export const WordFadeIn: StoryObj = {
  name: 'Word Fade-In',
  render: () => (
    <ScriptedChat
      height={520}
      script={streamMessage({
        id: 'msg-fade',
        role: 'assistant',
        text: MULTI_PARAGRAPH,
        chunkMs: 55,
        chunk: { mode: 'word', size: 1 },
      })}
    />
  ),
};

// ── BurstyVsSmoothed ─────────────────────────────────────────────────────────

/**
 * Two chat panels side-by-side showing the same bursty feed: the left renders
 * chunks as they arrive (large visual bursts); the right wraps the transcript
 * with `createStreamSmoother` for an even word cadence.
 *
 * Note: Storybook layout is "centered" so the two panels appear stacked — this
 * is intentional for simplicity. For true side-by-side, the host would need a
 * custom flex container.
 */
export const BurstyRaw: StoryObj = {
  name: 'Bursty (Raw)',
  render: () => (
    <ScriptedChat
      height={260}
      script={streamMessage({
        id: 'msg-raw',
        role: 'assistant',
        text: BURSTY_TEXT,
        chunkMs: 350,
        chunk: { mode: 'word', size: 8 },
      })}
    />
  ),
};

export const BurstySmoothed: StoryObj = {
  name: 'Bursty (Smoothed)',
  render: () => (
    <ScriptedChat
      height={260}
      wrapTranscript={(api) => createStreamSmoother(api, { wordsPerTick: 1, intervalMs: 40 })}
      script={streamMessage({
        id: 'msg-smooth',
        role: 'assistant',
        text: BURSTY_TEXT,
        chunkMs: 350,
        chunk: { mode: 'word', size: 8 },
      })}
    />
  ),
};

// ── SlowMotion ────────────────────────────────────────────────────────────────

/**
 * Very slow word cadence so each per-word fade+slide is clearly visible.
 * Also renders a finalized (non-streaming) control message below it to confirm
 * zero animation after commit.
 */
export const SlowMotion: StoryObj = {
  name: 'Slow Motion (inspect animation)',
  render: () => (
    <ScriptedChat
      height={400}
      script={streamMessage({
        id: 'msg-slow',
        role: 'assistant',
        text: 'Each word appears one at a time with a visible fade and slide animation. Once committed the text is static with no animation overhead.',
        chunkMs: 300,
        chunk: { mode: 'word', size: 1 },
      })}
    />
  ),
};
