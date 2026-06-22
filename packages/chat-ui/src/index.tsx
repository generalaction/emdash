/**
 * @emdash/chat-ui public API.
 *
 * mountChat(container, opts) — mount a Solid-based chat transcript renderer.
 * Returns a ChatHandle with the store API and a dispose() function.
 */

import './styles/global.css';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ChatRoot } from './ChatRoot';
import type { EngineControls } from './ChatRoot';
import type { ChatConfig } from './core/config';
import type { ChatHighlighter } from './core/highlight/highlighter';
import type { MentionProvider } from './core/markdown/mention-provider';
import type { ChatTheme } from './core/theme';
import { DEFAULT_THEME } from './core/theme';
import type { ChatImageAttachment, ChatItem } from './model';
import { createTranscript } from './state/transcript';
import type { TranscriptApi } from './state/transcript';
import { createViewState } from './state/view-state';
import type { ViewState } from './state/view-state';

export type {
  ChatItem,
  ChatMessage,
  ChatImageAttachment,
  ChatToolCall,
  ChatThinking,
  ChatFileOpToolCall,
  ChatExecute,
  ChatDiff,
  ChatResourceLink,
  ResourceTarget,
  ChatPlan,
  ChatPlanEntry,
  PlanEntryStatus,
  PlanEntryPriority,
  ChatRole,
  FileOpKind,
  FileOp,
  ToolStatus,
} from './model';
export type { TurnStatus } from './state/transcript';
export type { TranscriptApi, TranscriptEvent } from './state/transcript';
export type { ViewState } from './state/view-state';
export { generateMockTranscript } from './mock-transcript';
export type {
  ChatConfig,
  ChipConfig,
  ChatTheme,
  DensityScale,
  FontConfig,
  FontFamilies,
  ProseConfig,
  ResolvedTheme,
  RoleName,
  TypeRole,
} from './core/theme';
export { buildChatTheme, DEFAULT_CONFIG, DEFAULT_THEME } from './core/theme';
export type { ChatHighlighter, HighlightResult, CodeToken } from './core/highlight/highlighter';
export { createDefaultHighlighter } from './core/highlight/highlighter';
export type {
  MentionProvider,
  ChatMentionMeta,
  ChatMentionKind,
} from './core/markdown/mention-provider';

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Typed callbacks that host apps inject to respond to user actions inside the
 * chat transcript. Thread through `MountChatOptions.commands` (or update later
 * via `ChatHandle.setCommands`).
 */
export type ChatCommands = {
  /**
   * Called when the user clicks a file path in a diff header, file-op row,
   * resource-link card, or inline prose link.
   * `source` distinguishes the click origin; `itemId` is the ChatItem id.
   */
  onOpenFile?: (arg: {
    path: string;
    itemId: string;
    source: 'diff' | 'file-op' | 'resource-link' | 'prose-link';
  }) => void;

  /**
   * Called when the user clicks an image attachment thumbnail inside a user
   * message bubble. `itemId` is the ChatMessage id; `source` identifies the
   * click origin.
   */
  onViewImage?: (arg: {
    attachment: ChatImageAttachment;
    itemId: string;
    source: 'user-message';
  }) => void;

  /**
   * Called when the user clicks the stop button on the current user message
   * while the agent is generating. `itemId` is the user `ChatMessage` id.
   *
   * The host should cancel the in-progress agent turn. chat-ui will continue
   * showing the stop button until the host dispatches `turn_cancelled` (or
   * `turn_done`) to finalize the turn.
   */
  onStop?: (arg: { itemId: string }) => void;

  /**
   * Synchronously classify an `href` from a rendered markdown link.
   *
   * Returns `{ kind: 'workspace-file'; path: string }` if the href resolves to
   * a workspace file (click should open it in the editor), or
   * `{ kind: 'external' }` to keep the default external-link behavior.
   *
   * When absent, all markdown links open externally (today's behavior).
   *
   * The implementation must be synchronous and cheap (a cache lookup) because
   * it is called at render time.
   */
  classifyLink?: (href: string) => { kind: 'workspace-file'; path: string } | { kind: 'external' };
};

// ── Mount options ─────────────────────────────────────────────────────────────

export type MountChatOptions = {
  /**
   * Full resolved theme (output of buildChatTheme). When omitted, `config` is
   * used. Kept for back-compat with callers that build a theme directly.
   */
  theme?: ChatTheme;
  /**
   * Chat configuration (typography, chip geometry, prose geometry, density).
   * Derived once into a ResolvedTheme by ChatRoot. Ignored when `theme` is set.
   */
  config?: ChatConfig;
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
  /**
   * Optional syntax-highlighting adapter. When omitted the bundled default
   * (em-light/em-dark themes, common languages) is used.
   */
  highlighter?: ChatHighlighter;
  /**
   * Optional synchronous @-mention metadata resolver. When supplied, `@token`
   * spans in user messages that resolve to metadata are rendered as composer-style
   * pills. Must be stable for the lifetime of the mount.
   */
  mentionProvider?: MentionProvider;
  /**
   * When true, the active turn's user message is pinned to the top of the
   * transcript while scrolling, with a push-up transition as the next user
   * message enters the viewport. Defaults to false (no behavior change for
   * existing consumers).
   */
  pinUserMessages?: boolean;
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
        config={opts.config}
        stickToBottom={opts.stickToBottom}
        class={opts.class}
        contentClass={opts.contentClass}
        padTop={padTop}
        padBottom={padBottom}
        commands={commands}
        onReachStart={onReachStart}
        onAtBottomChange={onAtBottomChange}
        controls={controls}
        highlighter={opts.highlighter}
        mentionProvider={opts.mentionProvider}
        pinUserMessages={opts.pinUserMessages}
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
