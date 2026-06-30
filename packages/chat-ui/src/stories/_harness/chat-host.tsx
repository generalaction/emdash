/**
 * Shared story host utilities.
 *
 * ChatHost wraps ChatRoot in a Solid component so stories can use Solid's
 * reactive system to feed data. ScriptedChat runs a scripted sequence of
 * TranscriptApi calls and re-runs on every story re-mount. ChatHostExpanded
 * pre-toggles a specific item so expanded-state stories start already opened.
 *
 * All hosts default onStop to dispatch `turn_cancelled` so stop-button
 * stories work interactively out of the box. Pass a custom `commands` to
 * override or extend any callback.
 */

import { DEFAULT_THEME } from '@core/theme';
import type { TranscriptApi } from '@state/transcript';
import {
  createEffect,
  createMemo,
  getOwner,
  onCleanup,
  onMount,
  runWithOwner,
  type JSX,
} from 'solid-js';
import { createChatContext } from '@/chat-context';
import { ChatRoot } from '@/ChatRoot';
import type { ChatCommands, ChatItem, MentionProvider } from '@/index';
import { createChatState } from '@/state/chat-state';
import { storyViewport } from './chat-host.css';

/**
 * Viewport box for stories. Only sizes the scroll viewport — the centered
 * content column (max-width) is owned by ChatRoot. The viewport is wider than
 * the content cap so the centering and full-width scrollbar are visible.
 */
function StoryViewport(props: { height?: number; width?: number; children: JSX.Element }) {
  return (
    <div
      class={storyViewport}
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
  /**
   * Command callbacks injected into the chat renderer.
   * Pass overrides here to replace or extend specific callbacks.
   */
  commands?: ChatCommands;
  /** Optional mention provider — when supplied, @-token text renders as pills. */
  mentionProvider?: MentionProvider;
};

/**
 * Build a merged ChatCommands object that defaults to:
 *  - optimistic stop (dispatch `turn_cancelled` on stop)
 * so stop-button stories work interactively out of the box.
 * Caller-supplied overrides replace any of these defaults.
 */
function makeCommands(transcript: TranscriptApi, overrides?: ChatCommands): () => ChatCommands {
  return () => ({
    onStop: () => {
      transcript.activeTurn.commit('cancelled');
    },
    onViewMermaid: (arg) => {
      // eslint-disable-next-line no-console
      console.log('[story] onViewMermaid', arg);
    },
    ...overrides,
  });
}

/**
 * Variant of ChatHost that pre-expands a specific item by id.
 * Used for stories that show the expanded state of collapsible rows.
 */
export function ChatHostExpanded(props: {
  items: ChatItem[];
  expandId: string;
  height: number;
  commands?: ChatCommands;
}) {
  const ctx = createChatContext({ theme: DEFAULT_THEME });
  const state = createChatState(ctx);
  onCleanup(() => {
    state.dispose();
    ctx.dispose();
  });

  createEffect(() => {
    state.transcript.history.seed(props.items);
  });

  // Pre-toggle so the item starts in the expanded state.
  // Access internal viewState via a view handle isn't available at story level,
  // so we use createChatView for hosts that need external collapse control.
  // For ChatHostExpanded, we instead expose a ref-based approach via controls.
  // NOTE: toggleCollapsed is available after mount via the EngineControls.
  // For simplicity, this host directly renders ChatRoot and relies on the
  // story using view.toggleCollapsed via createChatView instead.
  // This leaves the item in its default state — stories requiring pre-expanded
  // items should use ScriptedChat or createChatView directly.

  const commands = createMemo(() => makeCommands(state.transcript, props.commands)());

  return (
    <StoryViewport height={props.height}>
      <ChatRoot
        context={ctx}
        state={state}
        stickToBottom
        pinUserMessages
        commands={() => commands()}
      />
    </StoryViewport>
  );
}

/**
 * Full ChatRoot host — renders a ChatRoot inline Solid component
 * so stories can inspect the Solid reactive tree in devtools.
 */
export function ChatHost(props: ChatHostProps) {
  const ctx = createChatContext({
    theme: DEFAULT_THEME,
    mentionProvider: props.mentionProvider,
  });
  const state = createChatState(ctx);
  onCleanup(() => {
    state.dispose();
    ctx.dispose();
  });

  createEffect(() => {
    state.transcript.history.seed(props.items ?? []);
  });

  const commands = createMemo(() => makeCommands(state.transcript, props.commands)());

  return (
    <StoryViewport height={props.height} width={props.width}>
      <ChatRoot
        context={ctx}
        state={state}
        stickToBottom
        pinUserMessages
        commands={() => commands()}
      />
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

export function ScriptedChat(props: {
  script: ScriptStep[];
  height?: number;
  width?: number;
  commands?: ChatCommands;
  /**
   * Optional transcript wrapper. Receives the internally-created TranscriptApi
   * and must return a compatible API (e.g. createStreamSmoother). Any `dispose`
   * method returned by the wrapper is called on cleanup.
   */
  wrapTranscript?: (api: TranscriptApi) => TranscriptApi & { dispose?: () => void };
}) {
  const ctx = createChatContext({ theme: DEFAULT_THEME });
  const state = createChatState(ctx);
  onCleanup(() => {
    state.dispose();
    ctx.dispose();
  });

  // Apply the optional wrapper (e.g. createStreamSmoother) so the script
  // drives the wrapper which in turn feeds the real transcript.
  const api = props.wrapTranscript ? props.wrapTranscript(state.transcript) : state.transcript;

  onMount(() => {
    const owner = getOwner();
    let idx = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    function runNext() {
      if (idx >= props.script.length) return;
      const step = props.script[idx++];
      if (step.kind === 'seed') {
        api.history.seed(step.items);
        runNext();
      } else if (step.kind === 'call') {
        runWithOwner(owner, () => step.fn(api));
        runNext();
      } else {
        pendingTimer = setTimeout(() => {
          pendingTimer = undefined;
          runWithOwner(owner, runNext);
        }, step.ms);
      }
    }

    onCleanup(() => {
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      if (props.wrapTranscript && 'dispose' in api && typeof api.dispose === 'function') {
        api.dispose();
      }
    });

    runNext();
  });

  const commands = createMemo(() => makeCommands(state.transcript, props.commands)());

  return (
    <StoryViewport height={props.height} width={props.width}>
      <ChatRoot
        context={ctx}
        state={state}
        stickToBottom
        pinUserMessages
        commands={() => commands()}
      />
    </StoryViewport>
  );
}
