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
  /** Short one-line synopsis shown alongside the tool name. */
  inputSummary?: string;
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

/** ACP tool-call categories that represent file operations. */
export type FileOpKind = 'read' | 'edit' | 'delete' | 'move';

/** A single file touched by a file-operation tool call. */
export type FileOp = {
  path: string;
};

/**
 * A file-operation tool call row (read / edit / delete / move).
 *
 * Single file (ops.length <= 1): renders as an inline one-liner, e.g. "Read foo.tsx".
 * Multiple files (ops.length > 1): renders as a collapsible header "Read 2 files ›"
 * that expands to a per-file list. While `status === 'running'` the collapsed
 * header shows a fixed-height streaming preview window (like ChatThinking).
 *
 * Collapse semantics are inverted: the stored "collapsed" bool means "expanded"
 * (same convention as ChatThinking).
 */
export type ChatFileOpToolCall = {
  kind: 'file-op';
  id: string;
  op: FileOpKind;
  status: ToolStatus;
  /** Accumulating list of files touched. Replaced (not appended) on each update. */
  ops: FileOp[];
};

/**
 * An execute tool call row — ACP `kind: 'execute'` commands (e.g. Bash).
 *
 * Rendered as a single non-interactive line: "Execute `{command}` {elapsed}s".
 * While running: shimmer + live ticking timer. When done: frozen duration if
 * durationMs is present; duration omitted if data is unavailable (e.g. replay).
 */
export type ChatExecute = {
  kind: 'execute';
  id: string;
  /** The shell command, e.g. "ls -a". Empty string until the command-bearing update arrives. */
  command: string;
  status: ToolStatus;
  /** Start time (epoch ms) — used to derive the live timer and frozen duration. */
  startedAt: number;
  /** Frozen duration once status flips to 'done'. Absent when data is unavailable. */
  durationMs?: number;
};

/**
 * A diff preview row — produced by ACP `kind: 'edit'` tool calls.
 *
 * Renders a compact, non-scrollable preview of the first changed region
 * (capped at 12 lines with ±1 context), with syntax + diff highlighting.
 * One `ChatDiff` is created per changed file within a single tool call.
 *
 * `oldText` is the replaced region (old_string). `null` means a new file —
 * all `newText` lines are additions.
 */
export type ChatDiff = {
  kind: 'diff';
  /** `${toolCallId}:${path}` — unique per file within a tool call. */
  id: string;
  /** Full path; basename and extension derived in the component. */
  path: string;
  /** The replaced region, or null for new files. */
  oldText: string | null;
  newText: string;
  status: ToolStatus;
};

export type ChatItem =
  | ChatMessage
  | ChatToolCall
  | ChatThinking
  | ChatFileOpToolCall
  | ChatExecute
  | ChatDiff;
