/**
 * @emdash/chat-ui public API.
 *
 * mountChat(container, opts) — mount a Solid-based chat transcript renderer.
 * Returns a ChatHandle with the store API and a dispose() function.
 */

import './tailwind.css';
import { render } from 'solid-js/web';
import { ChatRoot } from './ChatRoot';
import { DEFAULT_FONT_CONFIG } from './core/measure/fonts';
import type { FontConfig } from './core/measure/fonts';
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
  ChatRole,
  FileOpKind,
  FileOp,
} from './model';
export type { TranscriptApi, TranscriptEvent } from './state/transcript';
export type { ViewState } from './state/view-state';
export { generateMockTranscript } from './mock-transcript';

export type MountChatOptions = {
  fonts?: FontConfig;
  stickToBottom?: boolean;
  /** Pre-existing transcript store; if omitted a new one is created. */
  transcript?: TranscriptApi;
  /** Pre-existing view state; if omitted a new one is created. */
  viewState?: ViewState;
  /** Extra CSS class for the full-width scroll container. */
  class?: string;
  /** Classes for the centered content column (defaults to a max-width column). */
  contentClass?: string;
};

export type ChatHandle = {
  /** Transcript API for seeding/streaming data. */
  transcript: TranscriptApi;
  /** View state API for collapse management. */
  viewState: ViewState;
  /** Tear down the Solid root and remove all DOM. */
  dispose: () => void;
};

export function mountChat(container: HTMLElement, opts: MountChatOptions = {}): ChatHandle {
  const transcript = opts.transcript ?? createTranscript();
  const viewState = opts.viewState ?? createViewState();
  const fonts = opts.fonts ?? DEFAULT_FONT_CONFIG;

  const dispose = render(
    () => (
      <ChatRoot
        transcript={transcript}
        viewState={viewState}
        fonts={fonts}
        stickToBottom={opts.stickToBottom}
        class={opts.class}
        contentClass={opts.contentClass}
      />
    ),
    container
  );

  return { transcript, viewState, dispose };
}
