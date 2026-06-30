/**
 * ChatState — per-conversation, width-independent state.
 *
 * Holds the transcript (history + active turn), parse caches, and all
 * per-conversation view state that must survive view dispose/recreate
 * (e.g. tab switches):
 *
 *   viewState       — collapse map (inverted semantics: true = expanded)
 *   expandedUserId  — the single expanded user message card id
 *   scroll          — declarative scroll intent (ScrollMode: bottom|anchor|pinTop)
 *   heightmap       — Map<unitId, measuredHeight> keyed by RenderUnit.id
 *                     (stable "${itemId}#self"). lastWidth is the container
 *                     width at snapshot time; used by ChatRoot to decide
 *                     whether seeded heights are pixel-accurate or estimates.
 *
 * Lives under a `createRoot` so it persists across ChatView mounts:
 * disposing a view does NOT dispose the state, so re-attaching a view
 * reuses Block object identities and warm WeakMap measurement caches.
 *
 * Lifetime: per conversation. Dispose when the conversation is closed.
 *
 * Usage:
 *   const state = createChatState(ctx);
 *   state.transcript.history.seed(items);
 *   const view = createChatView({ context: ctx, state, parent });
 *   // ... later, on conversation close:
 *   state.dispose();
 *
 * Note: scroll is per-viewport in semantics. If two views ever attached to
 * the same ChatState simultaneously they would contend for scroll. Today
 * there is exactly one view per conversation (ChatRoot is keyed by
 * conversationId in AcpChatPanel) — this assumption is intentional.
 */

import { createRoot, createSignal } from 'solid-js';
import type { ChatContext } from '../chat-context';
import { createParseCaches } from '../core/caches';
import type { ParseCaches } from '../core/caches';
import { createTranscript } from './transcript';
import type { TranscriptApi } from './transcript';
import { createViewState } from './view-state';
import type { ViewState } from './view-state';

/**
 * Declarative scroll intent. Owned by ChatState.scroll and projected onto the
 * DOM's scrollTop by ChatRoot's projectScroll() — the sole scrollTop writer.
 *
 * `bottom`  — follow newest content; re-pin whenever content grows.
 * `anchor`  — user parked at a specific row; keep that row stable as content
 *             grows above or below it.
 * `pinTop`  — hold a specific row (typically the last user message) at the top
 *             of the viewport; used while the agent streams a response.
 */
export type ScrollMode =
  | { kind: 'bottom' }
  | { kind: 'anchor'; itemId: string; offset: number }
  | { kind: 'pinTop'; itemId: string };

/**
 * Per-conversation heightmap snapshot.
 *
 * Keys are stable `RenderUnit.id` values ("${itemId}#${key}", today always
 * "${itemId}#self" since every ChatItem maps to exactly one RenderUnit).
 * Values are measured row heights in pixels from the most recent view mount.
 *
 * `lastWidth` is the container width (px) when the snapshot was written.
 * ChatRoot uses it to decide whether to seed heights as pixel-accurate (same
 * width → no scrollbar drift) or as best-effort estimates (width changed →
 * anchor-based restore corrects position without drift).
 */
export type HeightmapStore = {
  /** Return the last-measured height for a unit id, or undefined on cache miss. */
  get(unitId: string): number | undefined;
  /** Bulk-write a set of unitId → height entries from a ChatRoot dispose snapshot. */
  setAll(entries: Iterable<[unitId: string, height: number]>): void;
  /** The container width when the most recent snapshot was taken. 0 = not set. */
  lastWidth: number;
};

export type ChatState = {
  /** Reactive transcript (history + active turn + turn status). */
  readonly transcript: TranscriptApi;
  /** Per-messageId parse caches. Stable Block identities enable WeakMap hits. */
  readonly parseCaches: ParseCaches;
  /**
   * Conversation URI passed to `createChatState`. Forwarded to
   * `MentionProvider.resolve` so a global provider can scope resolution to the
   * correct project or worktree.
   */
  readonly uri: string | undefined;

  // ── Per-conversation view state (persists across view remounts) ──────────

  /**
   * Collapse/expand state for collapsible rows.
   * Lives here (not in ChatRoot) so it survives tab switches.
   */
  readonly viewState: ViewState;

  /**
   * The id of the single currently-expanded user message card, or null.
   * Persisted here so re-mounting a view restores the expansion.
   */
  readonly expandedUserId: {
    get(): string | null;
    set(id: string | null): void;
  };

  /**
   * Declarative scroll intent. Written by ChatRoot's readPhase (user scroll)
   * and by the host via view.setScrollMode(); read by ChatRoot on mount/swap
   * to restore position without DOM geometry reads.
   */
  readonly scroll: {
    get(): ScrollMode;
    set(mode: ScrollMode): void;
  };

  /**
   * Measured row heights keyed by RenderUnit.id. Written by ChatRoot on
   * dispose; used to seed the Virtualizer on the next mount to avoid
   * scrollbar drift.
   */
  readonly heightmap: HeightmapStore;

  /**
   * Dispose the state's reactive root and all parse caches.
   * Call when the conversation is permanently closed (not just hidden).
   */
  dispose(): void;
};

export type ChatStateOptions = {
  /**
   * Conversation URI — passed as the second argument to
   * `MentionProvider.resolve(token, uri)` so the global provider can scope
   * resolution to the correct project or worktree.
   */
  uri?: string;
};

// ── createChatState ───────────────────────────────────────────────────────────

/**
 * Create a ChatState for a conversation.
 *
 * The state owns a `createRoot` so transcript signals, parse caches, and
 * per-conversation view state survive across view mounts/unmounts. Multiple
 * views can attach to the same state simultaneously (though only one view per
 * conversation is expected today — see scroll note above).
 *
 * @param ctx  - Shared ChatContext (provides highlighter, caches, theme).
 * @param opts - Optional per-conversation options (e.g. `uri`).
 */
export function createChatState(ctx: ChatContext, opts?: ChatStateOptions): ChatState {
  let transcript!: TranscriptApi;
  let parseCaches!: ParseCaches;
  let viewState!: ViewState;
  let getExpandedUserId!: () => string | null;
  let setExpandedUserId!: (id: string | null) => void;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    transcript = createTranscript();
    parseCaches = createParseCaches(ctx.mentionProvider, opts?.uri);
    viewState = createViewState();
    [getExpandedUserId, setExpandedUserId] = createSignal<string | null>(null);
  });

  // Scroll mode — plain mutable value; not reactive (ChatRoot reads it once on
  // mount/swap, writes it via setMode in readPhase and host calls). No signal.
  let scrollMode: ScrollMode = { kind: 'bottom' };

  // Heightmap — plain Map keyed by RenderUnit.id.
  const heightmapData = new Map<string, number>();
  let heightmapLastWidth = 0;

  const heightmap: HeightmapStore = {
    get(unitId) {
      return heightmapData.get(unitId);
    },
    setAll(entries) {
      for (const [id, h] of entries) {
        heightmapData.set(id, h);
      }
    },
    get lastWidth() {
      return heightmapLastWidth;
    },
    set lastWidth(w: number) {
      heightmapLastWidth = w;
    },
  };

  return {
    transcript,
    parseCaches,
    uri: opts?.uri,
    viewState,
    expandedUserId: {
      get: getExpandedUserId,
      set: setExpandedUserId,
    },
    scroll: {
      get: () => scrollMode,
      set: (mode) => {
        scrollMode = mode;
      },
    },
    heightmap,
    dispose() {
      parseCaches.clearAll();
      disposeRoot();
    },
  };
}
