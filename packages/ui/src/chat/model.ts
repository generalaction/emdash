/**
 * Transport-agnostic data model for the chat UI.
 * No ACP, IPC, or RPC types bleed in here.
 */

export type ChatRole = 'user' | 'assistant' | 'thought';

export type ToolStatus = 'running' | 'done' | 'error';

export type ThinkingStatus = 'thinking' | 'done';

export type ChatMessage = {
  kind: 'message';
  id: string;
  role: ChatRole;
  /** Markdown source text. */
  text: string;
  /** True while the agent is still writing to this message. */
  streaming?: boolean;
};

export type ChatToolCall = {
  kind: 'tool';
  id: string;
  name: string;
  status: ToolStatus;
  /** Short one-line synopsis shown in collapsed view. */
  inputSummary?: string;
  /** Full detail text (e.g. file path + diff), shown in expanded view. */
  detail?: string;
};

/**
 * A thinking / reasoning row produced by the agent before it replies.
 *
 * While `status === 'thinking'` the row shows a fixed-height streaming window
 * with the tail of the reasoning text truncated/faded at the top.
 * When `status === 'done'` the row collapses to a "Thought for {duration}s"
 * header that can be expanded to reveal the full reasoning text.
 */
export type ChatThinking = {
  kind: 'thinking';
  id: string;
  status: ThinkingStatus;
  /** Accumulating reasoning output (plain text / markdown). */
  text: string;
  /** Start time (epoch ms) — used to derive the live duration. */
  startedAt: number;
  /** Frozen duration once status flips to 'done'. */
  durationMs?: number;
};

export type ChatItem = ChatMessage | ChatToolCall | ChatThinking;
