/**
 * Shared story host utilities.
 *
 * ChatHost wraps mountChat in a Solid component so stories can use Solid's
 * reactive system to feed data. ScriptedChat runs a scripted sequence of
 * TranscriptApi calls and re-runs on every story re-mount.
 */

import { createEffect, onMount, type JSX } from 'solid-js';
import { ChatRoot } from '../ChatRoot';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { ChatItem } from '../model';
import { createTranscript } from '../state/transcript';
import type { TranscriptApi } from '../state/transcript';
import { createViewState } from '../state/view-state';

/**
 * Viewport box for stories. Only sizes the scroll viewport — the centered
 * content column (max-width) is owned by ChatRoot. The viewport is wider than
 * the content cap so the centering and full-width scrollbar are visible.
 */
function StoryViewport(props: { height?: number; width?: number; children: JSX.Element }) {
  return (
    <div
      class="overflow-hidden rounded-lg border border-border bg-background"
      style={{
        width: props.width ? `${props.width}px` : '880px',
        height: `${props.height ?? 600}px`,
      }}
    >
      {props.children}
    </div>
  );
}

/** Props shared by story hosts. */
export type ChatHostProps = {
  items?: ChatItem[];
  /** Override viewport width in px (default: 880). */
  width?: number;
  /** Viewport height in px (default: 600). */
  height?: number;
};

/**
 * Full ChatRoot host — renders a mountChat-equivalent inline Solid component
 * so stories can inspect the Solid reactive tree in devtools.
 */
export function ChatHost(props: ChatHostProps) {
  const transcript = createTranscript();
  const viewState = createViewState();

  createEffect(() => {
    transcript.seed(props.items ?? []);
  });

  return (
    <StoryViewport height={props.height} width={props.width}>
      <ChatRoot transcript={transcript} viewState={viewState} fonts={DEFAULT_FONT_CONFIG} stickToBottom />
    </StoryViewport>
  );
}

/**
 * Run a sequence of transcript mutations with optional delays.
 * Returns a function that starts the sequence; call once on mount.
 */
export type ScriptStep =
  | { kind: 'seed'; items: ChatItem[] }
  | { kind: 'call'; fn: (api: TranscriptApi) => void }
  | { kind: 'wait'; ms: number };

export function ScriptedChat(props: { script: ScriptStep[]; height?: number; width?: number }) {
  const transcript = createTranscript();
  const viewState = createViewState();

  onMount(() => {
    let idx = 0;
    const api = transcript;

    function runNext() {
      if (idx >= props.script.length) return;
      const step = props.script[idx++];
      if (step.kind === 'seed') {
        api.seed(step.items);
        runNext();
      } else if (step.kind === 'call') {
        step.fn(api);
        runNext();
      } else {
        setTimeout(runNext, step.ms);
      }
    }
    runNext();
  });

  return (
    <StoryViewport height={props.height} width={props.width}>
      <ChatRoot transcript={transcript} viewState={viewState} fonts={DEFAULT_FONT_CONFIG} stickToBottom />
    </StoryViewport>
  );
}
