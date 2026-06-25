/**
 * ChatState — per-conversation, width-independent state.
 *
 * Holds the transcript (history + active turn) and the messageId-keyed parse
 * caches. Lives under a `createRoot` so it persists across ChatView mounts:
 * disposing a view does NOT dispose the state, so re-attaching a view
 * reuses Block object identities and warm WeakMap measurement caches.
 *
 * Lifetime: per conversation. Dispose when the conversation is closed.
 *
 * Usage:
 *   const state = createChatState(ctx);
 *   state.transcript.history.seed(items);
 *   const view = createChatView({ context: ctx, state, parent });
 *   // ... later:
 *   state.dispose();
 */

import { createRoot } from 'solid-js';
import type { ChatContext } from '../chat-context';
import { createParseCaches } from '../core/caches';
import type { ParseCaches } from '../core/caches';
import { createTranscript } from './transcript';
import type { TranscriptApi } from './transcript';

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

/**
 * Create a ChatState for a conversation.
 *
 * The state owns a `createRoot` so transcript signals and parse caches
 * survive across view mounts/unmounts. Multiple views can attach to the same
 * state simultaneously.
 *
 * @param ctx  - Shared ChatContext (provides highlighter, caches, theme).
 * @param opts - Optional per-conversation options (e.g. `uri`).
 */
export function createChatState(ctx: ChatContext, opts?: ChatStateOptions): ChatState {
  let transcript!: TranscriptApi;
  let parseCaches!: ParseCaches;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    transcript = createTranscript();
    parseCaches = createParseCaches(ctx.mentionProvider, opts?.uri);
  });

  return {
    transcript,
    parseCaches,
    uri: opts?.uri,
    dispose() {
      parseCaches.clearAll();
      disposeRoot();
    },
  };
}
