import type { ZodType } from 'zod';
import type { Conversation } from '@shared/conversations';
import {
  mcpInvokeProjectListParamsSchema,
  mcpInvokeTaskCreateParamsSchema,
  mcpInvokeTaskListParamsSchema,
  mcpInvokeTerminalCreateParamsSchema,
  mcpInvokeTerminalListParamsSchema,
  mcpInvokeTerminalSendParamsSchema,
  mcpInvokeWorkspaceDevServersParamsSchema,
  type McpInvokeProjectListParams,
  type McpInvokeTaskCreateParams,
  type McpInvokeTaskListParams,
  type McpInvokeTerminalCreateParams,
  type McpInvokeTerminalListParams,
  type McpInvokeTerminalSendParams,
  type McpInvokeWorkspaceDevServersParams,
  type McpOkResponse,
  type McpProjectSummary,
  type McpTaskCreateResult,
  type McpTaskSummary,
  type McpTerminalCreateResult,
  type McpTerminalSummary,
  type McpWorkspaceDevServersResult,
} from '@shared/mcp/emdash-drive';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { mcpInternalService } from '@main/core/mcp-internal';
import {
  handleProjectList,
  handleTaskCreate,
  handleTaskList,
  handleTerminalCreate,
  handleTerminalList,
  handleTerminalSend,
} from '@main/core/mcp-internal/routes/orchestration';

interface CallerContext {
  conversation: Conversation;
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(message);
}

async function resolveCallerContext(callerConversationId: string): Promise<CallerContext> {
  const conversation = await getConversationById(callerConversationId);
  if (!conversation) {
    throw new Error(`caller conversation not found: ${callerConversationId}`);
  }
  return { conversation };
}

export async function invokeProjectList(
  input: McpInvokeProjectListParams
): Promise<McpProjectSummary[]> {
  const { callerConversationId, ...query } = parseOrThrow(mcpInvokeProjectListParamsSchema, input);
  return handleProjectList(await resolveCallerContext(callerConversationId), query);
}

export async function invokeTaskList(input: McpInvokeTaskListParams): Promise<McpTaskSummary[]> {
  const { callerConversationId, ...query } = parseOrThrow(mcpInvokeTaskListParamsSchema, input);
  return handleTaskList(await resolveCallerContext(callerConversationId), query);
}

export async function invokeTaskCreate(
  input: McpInvokeTaskCreateParams
): Promise<McpTaskCreateResult> {
  const { callerConversationId, ...body } = parseOrThrow(mcpInvokeTaskCreateParamsSchema, input);
  return handleTaskCreate(await resolveCallerContext(callerConversationId), body);
}

export async function invokeWorkspaceDevServers(
  input: McpInvokeWorkspaceDevServersParams
): Promise<McpWorkspaceDevServersResult> {
  const { callerConversationId } = parseOrThrow(mcpInvokeWorkspaceDevServersParamsSchema, input);
  const caller = await resolveCallerContext(callerConversationId);
  return {
    servers: mcpInternalService.listWorkspaceDevServers(caller.conversation.taskId),
  };
}

export async function invokeTerminalList(
  input: McpInvokeTerminalListParams
): Promise<McpTerminalSummary[]> {
  const { callerConversationId } = parseOrThrow(mcpInvokeTerminalListParamsSchema, input);
  return handleTerminalList(await resolveCallerContext(callerConversationId));
}

export async function invokeTerminalCreate(
  input: McpInvokeTerminalCreateParams
): Promise<McpTerminalCreateResult> {
  const { callerConversationId, ...body } = parseOrThrow(
    mcpInvokeTerminalCreateParamsSchema,
    input
  );
  return handleTerminalCreate(await resolveCallerContext(callerConversationId), body);
}

export async function invokeTerminalSend(
  input: McpInvokeTerminalSendParams
): Promise<McpOkResponse> {
  const { callerConversationId, terminalId, ...body } = parseOrThrow(
    mcpInvokeTerminalSendParamsSchema,
    input
  );
  return handleTerminalSend(await resolveCallerContext(callerConversationId), terminalId, body);
}

export const mcpDirectInvoke = {
  invokeProjectList,
  invokeTaskList,
  invokeTaskCreate,
  invokeWorkspaceDevServers,
  invokeTerminalList,
  invokeTerminalCreate,
  invokeTerminalSend,
};
