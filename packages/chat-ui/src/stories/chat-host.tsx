/**
 * Shared story host utilities.
 *
 * ChatHost wraps mountChat in a Solid component so stories can use Solid's
 * reactive system to feed data. ScriptedChat runs a scripted sequence of
 * TranscriptApi calls and re-runs on every story re-mount.
 */

import { For, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { ChatRoot } from '../ChatRoot';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { ChatItem } from '../model';
import { createTranscript } from '../state/transcript';
import type { TranscriptApi } from '../state/transcript';
import { createViewState } from '../state/view-state';
import styles from '../chat.module.css';

/** Props shared by story hosts. */
export type ChatHostProps = {
  items?: ChatItem[];
  /** Override width in px (default: auto). */
  width?: number;
  /** Height in px (default: 600). */
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

  const containerStyle = () => ({
    width: props.width ? `${props.width}px` : '640px',
    height: `${props.height ?? 600}px`,
    border: '1px solid var(--chat-border, #e2e8f0)',
    'border-radius': '8px',
    overflow: 'hidden',
  });

  return (
    <div style={containerStyle()}>
      <ChatRoot
        transcript={transcript}
        viewState={viewState}
        fonts={DEFAULT_FONT_CONFIG}
        stickToBottom
      />
    </div>
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
    <div
      style={{
        width: props.width ? `${props.width}px` : '640px',
        height: `${props.height ?? 600}px`,
        border: '1px solid var(--chat-border, #e2e8f0)',
        'border-radius': '8px',
        overflow: 'hidden',
      }}
    >
      <ChatRoot
        transcript={transcript}
        viewState={viewState}
        fonts={DEFAULT_FONT_CONFIG}
        stickToBottom
      />
    </div>
  );
}
