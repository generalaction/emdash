/**
 * @emdash/chat-ui public API.
 *
 * mountChat(container, opts) — mount a Solid-based chat transcript renderer.
 * Returns a ChatHandle with the store API and a dispose() function.
 */

import './tailwind.css';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ChatRoot } from './ChatRoot';
import type { EngineControls } from './ChatRoot';
import type { ChatTheme } from './core/theme';
import { DEFAULT_THEME } from './core/theme';
import type { ChatItem } from './model';
import { createTranscript } from './state/transcript';
import type { TranscriptApi } from './state/transcript';
import { createViewState } from './state/view-state';
import type { ViewState } from './state/view-state';

export type {
  ChatItem,
  ChatMessage,
  ChatToolCall,
  ChatThinking,
  ChatFileOpToolCall,
  ChatExecute,
  ChatDiff,
  ChatPlan,
  ChatPlanEntry,
  PlanEntryStatus,
  PlanEntryPriority,
  ChatRole,
  FileOpKind,
  FileOp,
  ToolStatus,
} from './model';
export type { TranscriptApi, TranscriptEvent } from './state/transcript';
export type { ViewState } from './state/view-state';
export { generateMockTranscript } from './mock-transcript';
export type { ChatTheme, DensityScale } from './core/theme';
export { buildTheme, DEFAULT_THEME } from './core/theme';

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Typed callbacks that host apps inject to respond to user actions inside the
 * chat transcript. Thread through `MountChatOptions.commands` (or update later
 * via `ChatHandle.setCommands`).
 */
export type ChatCommands = {
  /**
   * Called when the user clicks a file path in a diff header or file-op row.
   * `source` distinguishes the click origin; `itemId` is the ChatItem id.
   */
  onOpenFile?: (arg: { path: string; itemId: string; source: 'diff' | 'file-op' }) => void;
};

// ── Mount options ─────────────────────────────────────────────────────────────

export type MountChatOptions = {
  /** Full theme (fonts + geometry). Replaces the old `fonts` option. */
  theme?: ChatTheme;
  stickToBottom?: boolean;
  /** Pre-existing transcript store; if omitted a new one is created. */
  transcript?: TranscriptApi;
  /** Pre-existing view state; if omitted a new one is created. */
  viewState?: ViewState;
  /** Extra CSS class for the full-width scroll container. */
  class?: string;
  /** Classes for the centered content column (defaults to a max-width column). */
  contentClass?: string;
  /** Initial top padding (px) baked into the virtualizer coordinate space. */
  padTop?: number;
  /** Initial bottom padding (px) baked into the virtualizer coordinate space. */
  padBottom?: number;
  /**
   * Command callbacks invoked by user interactions inside the transcript.
   * Can be changed later via `ChatHandle.setCommands` without remounting.
   */
  commands?: ChatCommands;
  /**
   * Called when the user scrolls near the top of the transcript and the engine
   * has run out of buffered history. Host should fetch older items and call
   * `handle.loadOlder(items)`.
   */
  onReachStart?: () => void;
  /**
   * Called whenever the "at bottom" state changes. Useful for driving a
   * "jump to latest" button.
   */
  onAtBottomChange?: (atBottom: boolean) => void;
};

// ── Handle ────────────────────────────────────────────────────────────────────

export type ScrollToItemOptions = {
  /** Where to align the row within the viewport. Default: 'start'. */
  align?: 'start' | 'center' | 'end';
  /** Additional pixel offset applied after alignment. Default: 0. */
  offset?: number;
  /** Native scroll behavior. Default: 'auto'. */
  behavior?: ScrollBehavior;
};

export type ChatHandle = {
  /** Transcript API for seeding/streaming data. */
  transcript: TranscriptApi;
  /** View state API for collapse management. */
  viewState: ViewState;
  /**
   * Update the canvas padding reactively without remounting. Typically called
   * when a floating composer changes height via a ResizeObserver.
   */
  setContentPadding: (p: { top?: number; bottom?: number }) => void;
  /** Scroll to the bottom of the transcript. */
  scrollToBottom(opts?: { behavior?: ScrollBehavior }): void;
  /**
   * Scroll to the row with the given item id.
   * Best-effort precise: the target settles within a frame or two if it was
   * off-screen (its height was estimated, not measured).
   */
  scrollToItem(id: string, opts?: ScrollToItemOptions): void;
  /**
   * Prepend older history items above the current transcript without losing
   * scroll position. Pair with `onReachStart` for infinite-scroll pagination.
   */
  loadOlder(items: ChatItem[]): void;
  /**
   * Replace the active command callbacks without remounting. Safe to call
   * every render from the host (functions are captured by the engine and
   * invoked at call time, avoiding stale-closure issues).
   */
  setCommands(commands: ChatCommands): void;
  /** Tear down the Solid root and remove all DOM. */
  dispose: () => void;
};

// ── mountChat ─────────────────────────────────────────────────────────────────

export function mountChat(container: HTMLElement, opts: MountChatOptions = {}): ChatHandle {
  const transcript = opts.transcript ?? createTranscript();
  const viewState = opts.viewState ?? createViewState();
  const theme = opts.theme ?? DEFAULT_THEME;

  const [padTop, setPadTop] = createSignal(opts.padTop ?? 0);
  const [padBottom, setPadBottom] = createSignal(opts.padBottom ?? 0);
  const [commands, setCommands] = createSignal<ChatCommands>(opts.commands ?? {});

  // Holder filled by ChatRoot.onMount; delegated to by handle methods.
  const controls: EngineControls = {
    scrollToBottom: () => {},
    scrollToItem: () => {},
    loadOlder: () => {},
  };

  // Stable callbacks passed as props — engine reads from the holder at call time.
  const onReachStart = opts.onReachStart ? () => opts.onReachStart?.() : undefined;
  const onAtBottomChange = opts.onAtBottomChange
    ? (b: boolean) => opts.onAtBottomChange?.(b)
    : undefined;

  const dispose = render(
    () => (
      <ChatRoot
        transcript={transcript}
        viewState={viewState}
        theme={theme}
        stickToBottom={opts.stickToBottom}
        class={opts.class}
        contentClass={opts.contentClass}
        padTop={padTop}
        padBottom={padBottom}
        commands={commands}
        onReachStart={onReachStart}
        onAtBottomChange={onAtBottomChange}
        controls={controls}
      />
    ),
    container
  );

  const setContentPadding = (p: { top?: number; bottom?: number }) => {
    batch(() => {
      if (p.top !== undefined) setPadTop(p.top);
      if (p.bottom !== undefined) setPadBottom(p.bottom);
    });
  };

  return {
    transcript,
    viewState,
    setContentPadding,
    scrollToBottom: (opts2) => controls.scrollToBottom(opts2),
    scrollToItem: (id, opts2) => controls.scrollToItem(id, opts2),
    loadOlder: (items) => controls.loadOlder(items),
    setCommands,
    dispose,
  };
}
