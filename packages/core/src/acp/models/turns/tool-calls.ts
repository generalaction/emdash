import { z } from 'zod';
import { toolCallLinkFieldsSchema, toolStatusSchema } from './tools';

export const baseToolCallItemSchema = z
  .object({
    id: z.string(),
    /** Provider tool call id, stable across tool_call and tool_call_update notifications. */
    toolCallId: z.string(),
    title: z.string(),
    status: toolStatusSchema,
    /** Provider/plugin-generated short input description for compact display. */
    inputSummary: z.string().optional(),
  })
  .merge(toolCallLinkFieldsSchema);
export type BaseToolCallItem = z.infer<typeof baseToolCallItemSchema>;

export const transcriptExecuteToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('execute-tool-call'),
  command: z.string().optional(),
  /** Managed terminal id when this execute call is backed by terminal state. */
  terminalId: z.string().optional(),
});
export type TranscriptExecuteToolCall = z.infer<typeof transcriptExecuteToolCallSchema>;

export const transcriptReadToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('read-tool-call'),
  path: z.string().optional(),
  resource: z.string().optional(),
});
export type TranscriptReadToolCall = z.infer<typeof transcriptReadToolCallSchema>;

export const fileToolCallBaseSchema = baseToolCallItemSchema.extend({
  path: z.string(),
});
export type FileToolCallBase = z.infer<typeof fileToolCallBaseSchema>;

export const createFileToolCallSchema = fileToolCallBaseSchema.extend({
  kind: z.literal('create-file-tool-call'),
  content: z.string(),
});
export type CreateFileToolCall = z.infer<typeof createFileToolCallSchema>;

export const modifyFileToolCallSchema = fileToolCallBaseSchema.extend({
  kind: z.literal('modify-file-tool-call'),
  oldText: z.string(),
  newText: z.string(),
});
export type ModifyFileToolCall = z.infer<typeof modifyFileToolCallSchema>;

export const deleteFileToolCallSchema = fileToolCallBaseSchema.extend({
  kind: z.literal('delete-file-tool-call'),
});
export type DeleteFileToolCall = z.infer<typeof deleteFileToolCallSchema>;

export const transcriptSearchToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('search-tool-call'),
  query: z.string(),
  /** Provider-reported approximate match count when available. */
  matchCount: z.number().int().optional(),
});
export type TranscriptSearchToolCall = z.infer<typeof transcriptSearchToolCallSchema>;

export const transcriptMcpToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('mcp-tool-call'),
  /** MCP server name/id when the provider exposes it separately from the tool name. */
  server: z.string().optional(),
  tool: z.string(),
});
export type TranscriptMcpToolCall = z.infer<typeof transcriptMcpToolCallSchema>;

export const transcriptWebFetchToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('web-fetch-tool-call'),
  url: z.string(),
  pageTitle: z.string().optional(),
});
export type TranscriptWebFetchToolCall = z.infer<typeof transcriptWebFetchToolCallSchema>;

export const spawnSubagentToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('spawn-subagent-tool-call'),
  name: z.string(),
  /** True for async/background agents that can outlive the turn that launched them. */
  background: z.boolean().optional(),
  /** Provider/runtime id for matching later background-agent status updates. */
  agentId: z.string().optional(),
});
export type SpawnSubagentToolCall = z.infer<typeof spawnSubagentToolCallSchema>;

export const createPlanToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('create-plan-tool-call'),
  /** Session-scoped plan id resolved against PlanState. */
  planId: z.string(),
});
export type CreatePlanToolCall = z.infer<typeof createPlanToolCallSchema>;

export const transcriptUnknownToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('unknown-tool-call'),
  toolKind: z.string().nullable(),
  name: z.string(),
});
export type TranscriptUnknownToolCall = z.infer<typeof transcriptUnknownToolCallSchema>;

export const transcriptToolCallItemSchema = z.discriminatedUnion('kind', [
  transcriptExecuteToolCallSchema,
  transcriptReadToolCallSchema,
  createFileToolCallSchema,
  modifyFileToolCallSchema,
  deleteFileToolCallSchema,
  transcriptSearchToolCallSchema,
  transcriptMcpToolCallSchema,
  transcriptWebFetchToolCallSchema,
  spawnSubagentToolCallSchema,
  createPlanToolCallSchema,
  transcriptUnknownToolCallSchema,
]);
export type TranscriptToolCallItem = z.infer<typeof transcriptToolCallItemSchema>;

export type TranscriptTool = TranscriptUnknownToolCall;
export type TranscriptSubagent = SpawnSubagentToolCall;
export type TranscriptSearch = TranscriptSearchToolCall;
export type TranscriptMcpTool = TranscriptMcpToolCall;
export type TranscriptWebFetch = TranscriptWebFetchToolCall;
