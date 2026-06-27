/**
 * ChatState — per-conversation, width-independent state.
 *
 * Holds the transcript (history + active turn), parse caches, and all
 * per-conversation view state that must survive view dispose/recreate
 * (e.g. tab switches):
 *
 *   viewState       — collapse map (inverted semantics: true = expanded)
 *   expandedUserId  — the single expanded user message card id
 *   scroll          — anchor-based scroll position (itemId + offset + atBottom)
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
 * Anchor-based scroll position. Stored as an item id + pixel offset within
 * that item rather than a raw scrollTop so that the position remains valid
 * even when off-screen row heights are re-estimated on remount.
 *
 * `atBottom: true` overrides the anchor — the view should stick to the bottom
 * (correct for an active/streaming conversation).
 */
export type ScrollAnchor = {
  /** itemId of the row at the top of the viewport, or null if unknown. */
  anchorItemId: string | null;
  /** Pixel offset of the viewport top within the anchor row. */
  offsetWithinItem: number;
  /** True when the transcript was scrolled to the bottom at snapshot time. */
  atBottom: boolean;
};

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
   * Anchor-based scroll position. Written by ChatRoot on each read phase tick
   * and on dispose; read by ChatRoot on mount to restore position.
   */
  readonly scroll: {
    get(): ScrollAnchor;
    set(anchor: ScrollAnchor): void;
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

  // Scroll anchor — plain mutable object; not reactive (ChatRoot reads it
  // once on mount, writes it on readPhase/dispose). No signal needed.
  let scrollAnchor: ScrollAnchor = { anchorItemId: null, offsetWithinItem: 0, atBottom: true };

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
      get: () => scrollAnchor,
      set: (anchor) => {
        scrollAnchor = anchor;
      },
    },
    heightmap,
    dispose() {
      parseCaches.clearAll();
      disposeRoot();
    },
  };
}
