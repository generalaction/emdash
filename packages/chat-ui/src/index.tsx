/**
 * @emdash/chat-ui public API.
 *
 * Three primitives following the CodeMirror EditorState/EditorView split:
 *
 *   createChatContext(opts) — global services singleton (theme, highlighter,
 *                             shared caches, measureEpoch). Create once per app.
 *   createChatState(ctx)   — per-conversation state (transcript + parse caches).
 *   createChatView(opts)   — per-mount DOM owner (virtualizer, scroll, scheduler).
 *
 * Quick start:
 *   const ctx  = createChatContext({ highlighter });
 *   const st   = createChatState(ctx);
 *   const view = createChatView({ context: ctx, state: st, parent, composer: 'slot' });
 *   st.transcript.history.seed(items);
 *   // After mount:
 *   ReactDOM.createPortal(<ChatComposer />, view.composerSlot!);
 *   // Cleanup:
 *   view.dispose();
 *   st.dispose();
 *   ctx.dispose();
 */

import './styles/global.css';
import type { ChatImageAttachment } from './model';

// ── Core API ──────────────────────────────────────────────────────────────────

export { createChatContext } from './chat-context';
export type { ChatContext, ChatContextOptions } from './chat-context';

export { createChatState } from './state/chat-state';
export type { ChatState, ChatStateOptions } from './state/chat-state';

export { createChatView } from './chat-view';
export type { ChatView, ChatViewOptions, ChatViewSnapshot } from './chat-view';

// ── Data types ────────────────────────────────────────────────────────────────

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

// ── Transcript API ────────────────────────────────────────────────────────────

export type { TurnStatus, TranscriptApi, ChatHistory, ActiveTurn } from './state/transcript';
export { createTranscript } from './state/transcript';
export type { ActiveTurnEvent } from './state/turn-reducer';
export { applyTurnEvent, finalizeTurn } from './state/turn-reducer';
export { createStreamSmoother } from './state/stream-smoother';
export type {
  StreamSmoother,
  StreamSmootherOptions,
  SmootherScheduler,
  TranscriptEvent,
} from './state/stream-smoother';

// ── Theme ─────────────────────────────────────────────────────────────────────

export type {
  ChatConfig,
  ChipConfig,
  ChatTheme,
  FontConfig,
  FontFamilies,
  ResolvedTheme,
  RoleName,
  TypeRole,
} from './core/theme';
export { buildChatTheme, DEFAULT_CONFIG, DEFAULT_THEME } from './core/theme';

// ── Highlighter ───────────────────────────────────────────────────────────────

export type { ChatHighlighter, HighlightResult, CodeToken } from './core/highlight/highlighter';
export { createDefaultHighlighter } from './core/highlight/highlighter';

// ── Mention provider ─────────────────────────────────────────────────────────

export type {
  MentionProvider,
  ChatMentionMeta,
  ChatMentionKind,
} from './core/markdown/mention-provider';

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Typed callbacks that host apps inject to respond to user actions inside the
 * chat transcript. Pass via `createChatView({ commands })` or update later
 * via `view.setCommands(commands)`.
 */
export type ChatCommands = {
  /**
   * Called when the user clicks a file path in a diff header, file-op row,
   * resource-link card, or inline prose link.
   */
  onOpenFile?: (arg: {
    path: string;
    itemId: string;
    source: 'diff' | 'file-op' | 'resource-link' | 'prose-link';
  }) => void;

  /**
   * Called when the user clicks an image attachment thumbnail inside a user
   * message bubble.
   */
  onViewImage?: (arg: {
    attachment: ChatImageAttachment;
    itemId: string;
    source: 'user-message';
  }) => void;

  /**
   * Called when the user clicks the stop button on the current user message
   * while the agent is generating.
   */
  onStop?: (arg: { itemId: string }) => void;

  /**
   * Synchronously classify an `href` from a rendered markdown link.
   * Returns `{ kind: 'workspace-file'; path: string }` for workspace files,
   * or `{ kind: 'external' }` to keep the default external-link behavior.
   */
  classifyLink?: (href: string) => { kind: 'workspace-file'; path: string } | { kind: 'external' };

  /**
   * Called when the user clicks a Mermaid diagram block preview.
   */
  onViewMermaid?: (arg: { chart: string; blockId: string; source: 'mermaid-block' }) => void;
};

// ── Scroll helpers ────────────────────────────────────────────────────────────

export type ScrollToItemOptions = {
  /** Where to align the row within the viewport. Default: 'start'. */
  align?: 'start' | 'center' | 'end';
  /** Additional pixel offset applied after alignment. Default: 0. */
  offset?: number;
  /** Native scroll behavior. Default: 'auto'. */
  behavior?: ScrollBehavior;
};

// ── Dev helpers ───────────────────────────────────────────────────────────────

export { generateMockTranscript, mockMentionProvider } from './mock-transcript';

// ── Cache types (for advanced use) ────────────────────────────────────────────

export type { ChatCaches, SharedCaches, ParseCaches } from './core/caches';
export { createChatCaches } from './core/caches';
