/**
 * Shared story host utilities.
 *
 * ChatHost wraps mountChat in a Solid component so stories can use Solid's
 * reactive system to feed data. ScriptedChat runs a scripted sequence of
 * TranscriptApi calls and re-runs on every story re-mount. ChatHostExpanded
 * pre-toggles a specific item so expanded-state stories start already opened.
 */

import { createEffect, getOwner, onCleanup, onMount, runWithOwner, type JSX } from 'solid-js';
import { ChatRoot } from '../ChatRoot';
import { DEFAULT_THEME } from '../core/theme';
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
 * Variant of ChatHost that pre-expands a specific item by id.
 * Used for stories that show the expanded state of collapsible rows.
 */
export function ChatHostExpanded(props: { items: ChatItem[]; expandId: string; height: number }) {
  const transcript = createTranscript();
  const viewState = createViewState();

  createEffect(() => {
    transcript.seed(props.items);
  });

  // Pre-toggle so the item starts in the expanded state.
  viewState.toggleCollapsed(props.expandId);

  return (
    <StoryViewport height={props.height}>
      <ChatRoot transcript={transcript} viewState={viewState} theme={DEFAULT_THEME} stickToBottom />
    </StoryViewport>
  );
}

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
      <ChatRoot transcript={transcript} viewState={viewState} theme={DEFAULT_THEME} stickToBottom />
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
    const owner = getOwner();
    const api = transcript;
    let idx = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    function runNext() {
      if (idx >= props.script.length) return;
      const step = props.script[idx++];
      if (step.kind === 'seed') {
        api.seed(step.items);
        runNext();
      } else if (step.kind === 'call') {
        // Run inside the component's reactive owner so Solid tracks any store
        // reads and the reactive graph stays connected across setTimeout calls.
        runWithOwner(owner, () => step.fn(api));
        runNext();
      } else {
        pendingTimer = setTimeout(() => {
          pendingTimer = undefined;
          runWithOwner(owner, runNext);
        }, step.ms);
      }
    }

    // Cancel any in-flight timer when the component is disposed (HMR /
    // story re-mount / theme-debug toggle). Without this, the old timer chain
    // would keep firing and mutate the dead store instance.
    onCleanup(() => {
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
    });

    runNext();
  });

  return (
    <StoryViewport height={props.height} width={props.width}>
      <ChatRoot transcript={transcript} viewState={viewState} theme={DEFAULT_THEME} stickToBottom />
    </StoryViewport>
  );
}
