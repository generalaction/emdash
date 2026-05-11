import { z } from 'zod';

const callerConversationSchema = z.object({
  callerConversationId: z.string().min(1),
});

export const mcpProjectListParamsSchema = z.object({
  includeArchived: z.boolean().optional(),
});
export type McpProjectListParams = z.infer<typeof mcpProjectListParamsSchema>;
export const mcpInvokeProjectListParamsSchema =
  callerConversationSchema.merge(mcpProjectListParamsSchema);
export type McpInvokeProjectListParams = z.infer<typeof mcpInvokeProjectListParamsSchema>;

export const mcpTaskListParamsSchema = z.object({
  projectId: z.string().optional(),
  includeArchived: z.boolean().optional(),
});
export type McpTaskListParams = z.infer<typeof mcpTaskListParamsSchema>;
export const mcpInvokeTaskListParamsSchema = callerConversationSchema.merge(mcpTaskListParamsSchema);
export type McpInvokeTaskListParams = z.infer<typeof mcpInvokeTaskListParamsSchema>;

const mcpTaskCreateParamsShape = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  sourceBranch: z.string().optional(),
  taskBranch: z.string().optional(),
  initialPrompt: z.string().optional(),
  providerId: z.string().optional(),
  strategy: z.enum(['new-branch']).optional(),
});

export const mcpTaskCreateParamsSchema = mcpTaskCreateParamsShape.refine(
  (value) => !value.initialPrompt || value.providerId,
  {
    message: 'initialPrompt requires providerId',
    path: ['initialPrompt'],
  }
);
export type McpTaskCreateParams = z.infer<typeof mcpTaskCreateParamsSchema>;

export const mcpInvokeTaskCreateParamsSchema = callerConversationSchema
  .merge(mcpTaskCreateParamsShape)
  .refine((value) => !value.initialPrompt || value.providerId, {
    message: 'initialPrompt requires providerId',
    path: ['initialPrompt'],
  });
export type McpInvokeTaskCreateParams = z.infer<typeof mcpInvokeTaskCreateParamsSchema>;

export const mcpWorkspaceDevServersParamsSchema = z.object({});
export type McpWorkspaceDevServersParams = z.infer<typeof mcpWorkspaceDevServersParamsSchema>;
export const mcpInvokeWorkspaceDevServersParamsSchema = callerConversationSchema;
export type McpInvokeWorkspaceDevServersParams = z.infer<
  typeof mcpInvokeWorkspaceDevServersParamsSchema
>;

export const mcpTerminalListParamsSchema = z.object({});
export type McpTerminalListParams = z.infer<typeof mcpTerminalListParamsSchema>;
export const mcpInvokeTerminalListParamsSchema = callerConversationSchema;
export type McpInvokeTerminalListParams = z.infer<typeof mcpInvokeTerminalListParamsSchema>;

export const mcpTerminalCreateParamsSchema = z.object({
  initialCommand: z.string().optional(),
  name: z.string().optional(),
});
export type McpTerminalCreateParams = z.infer<typeof mcpTerminalCreateParamsSchema>;
export const mcpInvokeTerminalCreateParamsSchema =
  callerConversationSchema.merge(mcpTerminalCreateParamsSchema);
export type McpInvokeTerminalCreateParams = z.infer<typeof mcpInvokeTerminalCreateParamsSchema>;

export const mcpTerminalSendBodySchema = z.object({
  text: z.string(),
  submit: z.boolean().optional(),
});
export type McpTerminalSendBody = z.infer<typeof mcpTerminalSendBodySchema>;
export const mcpInvokeTerminalSendParamsSchema = callerConversationSchema.merge(
  z.object({
    terminalId: z.string().min(1),
  })
).merge(mcpTerminalSendBodySchema);
export type McpInvokeTerminalSendParams = z.infer<typeof mcpInvokeTerminalSendParamsSchema>;

export interface McpProjectSummary {
  id: string;
  name: string;
  path: string;
  baseRef: string | null;
  archived: boolean;
}

export interface McpTaskSummary {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  status: string;
  taskBranch?: string;
  archivedAt?: string;
  lastInteractedAt?: string;
}

export interface McpTaskCreateResult {
  taskId: string;
  taskName: string;
  taskBranch?: string;
  projectId: string;
  conversationId?: string;
}

export interface McpWorkspaceDevServer {
  terminalId: string;
  url: string;
  detectedAt: number;
}

export interface McpWorkspaceDevServersResult {
  servers: McpWorkspaceDevServer[];
}

export interface McpTerminalSummary {
  id: string;
  taskId: string;
  projectId: string;
  name: string;
}

export interface McpTerminalCreateResult {
  terminalId: string;
  name: string;
}

export interface McpOkResponse {
  ok: true;
}
