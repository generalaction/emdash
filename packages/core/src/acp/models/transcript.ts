/**
 * Core-owned, presentation-neutral transcript model.
 *
 * Plain JSON throughout — no Date, Map, or Set instances — so the model stays
 * compatible with LiveModel (Immer patches + structuredClone) and wire transport.
 */

/**
 * A reference to a persisted attachment (image submitted with a user prompt).
 * Bytes are NOT stored inline; the runtime resolves them on demand via the ref.
 * Keeps the transcript model LiveModel-compatible (no base64 data-URLs in patches).
 */
export type AttachmentRef = {
  id: string;
  name: string;
  mimeType: string;
};

export type ToolStatus = 'running' | 'done' | 'error';

/** Lifecycle status of a single plan entry. */
export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed';

/** Relative importance of a plan entry. */
export type PlanEntryPriority = 'high' | 'medium' | 'low';

export type TranscriptPlanEntry = {
  content: string;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
};

export type TranscriptMessage = {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True while the agent is still streaming to this message. */
  streaming: boolean;
  /** Attachment references (user messages). Resolved to dataUrl by the client. */
  attachments?: AttachmentRef[];
};

export type TranscriptThinking = {
  kind: 'thinking';
  id: string;
  /** Provider-assigned or synthesized message id for this thinking block. */
  messageId: string;
  /** Accumulating reasoning text. */
  text: string;
  /** 'thinking' while streaming; 'done' after finalization. */
  status: 'thinking' | 'done';
  /** Epoch ms when the thinking row opened. Plain number — JSON-safe. */
  startedAt: number;
  /** Frozen duration once status flips to 'done'. Absent until finalized. */
  durationMs?: number;
};

export type TranscriptTool = {
  kind: 'tool';
  id: string;
  name: string;
  status: ToolStatus;
  inputSummary?: string;
  parentId?: string;
};

export type TranscriptSubagent = {
  kind: 'subagent';
  id: string;
  name: string;
  status: ToolStatus;
  inputSummary?: string;
  parentId?: string;
};

export type TranscriptSearch = {
  kind: 'search';
  id: string;
  query: string;
  status: ToolStatus;
  matchCount?: number;
  parentId?: string;
};

export type TranscriptMcpTool = {
  kind: 'mcp-tool';
  id: string;
  server?: string;
  tool: string;
  status: ToolStatus;
  inputSummary?: string;
  parentId?: string;
};

export type TranscriptWebFetch = {
  kind: 'web-fetch';
  id: string;
  url: string;
  title?: string;
  status: ToolStatus;
  parentId?: string;
};

export type TranscriptDiff = {
  kind: 'diff';
  id: string;
  path: string;
  oldText: string | null;
  newText: string;
  status: ToolStatus;
  parentId?: string;
};

export type TranscriptPlan = {
  kind: 'plan';
  id: string;
  entries: TranscriptPlanEntry[];
  /** True while entries are still being appended during streaming. */
  streaming: boolean;
};

export type TranscriptItem =
  | TranscriptMessage
  | TranscriptThinking
  | TranscriptTool
  | TranscriptSubagent
  | TranscriptSearch
  | TranscriptMcpTool
  | TranscriptWebFetch
  | TranscriptDiff
  | TranscriptPlan;

/**
 * A single prompt–response exchange materialized as a flat item list.
 *
 * No `stopReason` or turn-level status: stop reasons are ephemeral session
 * state (recorded by the session state machine, not the transcript). The
 * distinction between a turn being active vs committed is carried by whether
 * it is `TranscriptState.active` or in `TranscriptState.committed`.
 */
export type TranscriptTurn = {
  id: string;
  items: TranscriptItem[];
};

/**
 * The full transcript state produced and updated by AcpTranscriptParser.
 * `active` is the in-flight turn (null when idle); `committed` are all
 * finalized turns in chronological order.
 */
export type TranscriptState = {
  committed: TranscriptTurn[];
  active: TranscriptTurn | null;
};
