import { z } from 'zod';
import { toolCallLinkFieldsSchema, toolStatusSchema } from '../tools';

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

export const transcriptEditToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('edit-tool-call'),
  path: z.string().optional(),
  diffIds: z.array(z.string()).optional(),
});
export type TranscriptEditToolCall = z.infer<typeof transcriptEditToolCallSchema>;

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

export const transcriptSubagentToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('subagent-tool-call'),
  name: z.string(),
  /** True for async/background agents that can outlive the turn that launched them. */
  background: z.boolean().optional(),
  /** Provider/runtime id for matching later background-agent status updates. */
  agentId: z.string().optional(),
  /** Provider-managed file containing background-agent output, when available. */
  outputFile: z.string().optional(),
});
export type TranscriptSubagentToolCall = z.infer<typeof transcriptSubagentToolCallSchema>;

export const transcriptUnknownToolCallSchema = baseToolCallItemSchema.extend({
  kind: z.literal('unknown-tool-call'),
  toolKind: z.string().nullable(),
  name: z.string(),
});
export type TranscriptUnknownToolCall = z.infer<typeof transcriptUnknownToolCallSchema>;

export const transcriptToolCallItemSchema = z.discriminatedUnion('kind', [
  transcriptExecuteToolCallSchema,
  transcriptReadToolCallSchema,
  transcriptEditToolCallSchema,
  transcriptSearchToolCallSchema,
  transcriptMcpToolCallSchema,
  transcriptWebFetchToolCallSchema,
  transcriptSubagentToolCallSchema,
  transcriptUnknownToolCallSchema,
]);
export type TranscriptToolCallItem = z.infer<typeof transcriptToolCallItemSchema>;

export type TranscriptTool = TranscriptUnknownToolCall;
export type TranscriptSubagent = TranscriptSubagentToolCall;
export type TranscriptSearch = TranscriptSearchToolCall;
export type TranscriptMcpTool = TranscriptMcpToolCall;
export type TranscriptWebFetch = TranscriptWebFetchToolCall;
