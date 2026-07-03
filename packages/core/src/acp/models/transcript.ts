import { z } from 'zod';
import {
  attachmentRefSchema,
  stopReasonSchema,
  toolStatusSchema,
} from './common';

export const transcriptMessageSchema = z.object({
  kind: z.literal('message'),
  /** Provider message id scoped to the turn, or reducer-synthesized fallback id. */
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** True while later chunks may append to this message within the active turn. */
  streaming: z.boolean(),
  /** Attachment metadata only; bytes are served separately by the runtime. */
  attachments: z.array(attachmentRefSchema).optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

export const transcriptThinkingSchema = z.object({
  kind: z.literal('thinking'),
  id: z.string(),
  /** Provider or synthesized message segment id this reasoning block belongs to. */
  messageId: z.string(),
  text: z.string(),
  status: z.enum(['thinking', 'done']),
  /** Epoch ms when the thinking row opened. */
  startedAt: z.number(),
  /** Frozen duration once the row is finalized. */
  durationMs: z.number().optional(),
});
export type TranscriptThinking = z.infer<typeof transcriptThinkingSchema>;

export const transcriptToolSchema = z.object({
  kind: z.literal('tool'),
  id: z.string(),
  name: z.string(),
  status: toolStatusSchema,
  /** Provider/plugin-generated short input description for compact display. */
  inputSummary: z.string().optional(),
  /** Transcript item id of the parent tool/subagent, for nested tool rendering. */
  parentId: z.string().optional(),
});
export type TranscriptTool = z.infer<typeof transcriptToolSchema>;

export const transcriptSubagentSchema = z.object({
  kind: z.literal('subagent'),
  id: z.string(),
  name: z.string(),
  status: toolStatusSchema,
  inputSummary: z.string().optional(),
  parentId: z.string().optional(),
  /** True for async/background agents that can outlive the turn that launched them. */
  background: z.boolean().optional(),
  /** Provider/runtime id for matching later background-agent status updates. */
  agentId: z.string().optional(),
  /** Provider-managed file containing background-agent output, when available. */
  outputFile: z.string().optional(),
});
export type TranscriptSubagent = z.infer<typeof transcriptSubagentSchema>;

export const transcriptSearchSchema = z.object({
  kind: z.literal('search'),
  id: z.string(),
  query: z.string(),
  status: toolStatusSchema,
  /** Provider-reported approximate match count when available. */
  matchCount: z.number().int().optional(),
  parentId: z.string().optional(),
});
export type TranscriptSearch = z.infer<typeof transcriptSearchSchema>;

export const transcriptMcpToolSchema = z.object({
  kind: z.literal('mcp-tool'),
  id: z.string(),
  /** MCP server name/id when the provider exposes it separately from the tool name. */
  server: z.string().optional(),
  tool: z.string(),
  status: toolStatusSchema,
  inputSummary: z.string().optional(),
  parentId: z.string().optional(),
});
export type TranscriptMcpTool = z.infer<typeof transcriptMcpToolSchema>;

export const transcriptWebFetchSchema = z.object({
  kind: z.literal('web-fetch'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  status: toolStatusSchema,
  parentId: z.string().optional(),
});
export type TranscriptWebFetch = z.infer<typeof transcriptWebFetchSchema>;

export const transcriptDiffSchema = z.object({
  kind: z.literal('diff'),
  id: z.string(),
  path: z.string(),
  /** Null when the file did not exist before the edit. */
  oldText: z.string().nullable(),
  newText: z.string(),
  status: toolStatusSchema,
  parentId: z.string().optional(),
});
export type TranscriptDiff = z.infer<typeof transcriptDiffSchema>;

export const transcriptPlanSchema = z.object({
  kind: z.literal('plan'),
  /** Marker item id scoped to the turn; actual plan content lives in the plan slice. */
  id: z.string(),
  /** Session-scoped plan id resolved against TranscriptPlanState. */
  planId: z.string(),
  /** Epoch ms of the plan update represented by this marker. */
  updatedAt: z.number(),
});
export type TranscriptPlan = z.infer<typeof transcriptPlanSchema>;

export const transcriptItemSchema = z.discriminatedUnion('kind', [
  transcriptMessageSchema,
  transcriptThinkingSchema,
  transcriptToolSchema,
  transcriptSubagentSchema,
  transcriptSearchSchema,
  transcriptMcpToolSchema,
  transcriptWebFetchSchema,
  transcriptDiffSchema,
  transcriptPlanSchema,
]);
export type TranscriptItem = z.infer<typeof transcriptItemSchema>;

export const transcriptTurnInitiatorSchema = z.enum(['user', 'agent']);
export type TranscriptTurnInitiator = z.infer<typeof transcriptTurnInitiatorSchema>;

/** Successful turn reasons include ACP stop reasons plus runtime quiescence. */
export const doneTurnReasonSchema = z.union([stopReasonSchema, z.literal('quiesced')]);
export type DoneTurnReason = z.infer<typeof doneTurnReasonSchema>;

/** Cancellation is modeled as its own outcome instead of a successful stop reason. */
export const cancelledTurnReasonSchema = z.literal('cancelled');
export type CancelledTurnReason = z.infer<typeof cancelledTurnReasonSchema>;

/** Runtime-normalized failure categories that can settle a transcript turn. */
export const errorTurnReasonSchema = z.enum([
  'prompt_failed',
  'process_closed',
  'spawn_failed',
  'initialize_failed',
  'new_session_failed',
  'load_session_failed',
  'cancel_failed',
  'set_config_failed',
  'set_mode_failed',
]);
export type ErrorTurnReason = z.infer<typeof errorTurnReasonSchema>;

/** Non-error interruption reasons for turns superseded by lifecycle events. */
export const interruptedTurnReasonSchema = z.enum(['process_closed', 'replaced']);
export type InterruptedTurnReason = z.infer<typeof interruptedTurnReasonSchema>;

export const transcriptTurnOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done'), reason: doneTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('cancelled'), reason: cancelledTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('error'), reason: errorTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('interrupted'), reason: interruptedTurnReasonSchema.optional() }),
]);
export type TranscriptTurnOutcome = z.infer<typeof transcriptTurnOutcomeSchema>;

export const transcriptTurnSchema = z.object({
  /** Reducer-generated turn id used to scope all item ids in this exchange. */
  id: z.string(),
  /** Who opened the turn: a user prompt or agent-originated background activity. */
  initiator: transcriptTurnInitiatorSchema,
  items: z.array(transcriptItemSchema),
  /** Durable settlement for the whole turn; absent for replayed history without an explicit end. */
  outcome: transcriptTurnOutcomeSchema.optional(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const transcriptStateSchema = z.object({
  /** Finalized turns in chronological order. */
  committed: z.array(transcriptTurnSchema),
  /** Current in-flight turn, or null when the transcript is idle. */
  active: transcriptTurnSchema.nullable(),
});
export type TranscriptState = z.infer<typeof transcriptStateSchema>;
