import { operationStatuses } from '@primitives/kernel/api';
import { hostAbsolutePathSchema } from '@primitives/path/api';
import { z } from 'zod';

/**
 * Narrow, transport-level mirror of the workspace-host runtime surface that
 * host-resident consumers (currently the automations runtime) depend on. The
 * full workspace-host runtime client satisfies this contract structurally;
 * compatibility is enforced by the wiring typecheck where the client is
 * provided as a component dependency.
 */
export const workspaceHostActionErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type WorkspaceHostActionError = z.infer<typeof workspaceHostActionErrorSchema>;

export const createWorktreeActionInputSchema = z.object({
  version: z.literal('1'),
  operationId: z.string().min(1),
  hostId: z.string().min(1),
  repoPath: hostAbsolutePathSchema,
  worktreePath: hostAbsolutePathSchema,
  branchName: z.string().min(1),
  startPoint: z.string().min(1).optional(),
  fetch: z.boolean().optional(),
  /** When set, push the branch to this remote with upstream tracking after creation. */
  pushRemote: z.string().min(1).optional(),
  preservePatterns: z.array(z.string()).default([]),
});
export type CreateWorktreeActionInput = z.infer<typeof createWorktreeActionInputSchema>;

export const createWorktreeActionSchema = z.object({
  verb: z.literal('host.createWorktree'),
  input: createWorktreeActionInputSchema,
});
export type CreateWorktreeAction = z.infer<typeof createWorktreeActionSchema>;

export const workspaceHostActionSubmitResultSchema = z.object({
  operationId: z.string(),
  kernelOperationId: z.string(),
});
export type WorkspaceHostActionSubmitResult = z.infer<typeof workspaceHostActionSubmitResultSchema>;

export const workspaceHostActionQuerySchema = z.object({
  operationId: z.string().min(1),
});
export type WorkspaceHostActionQuery = z.infer<typeof workspaceHostActionQuerySchema>;

export const workspaceHostActionStatusSchema = z.enum(operationStatuses);
export type WorkspaceHostActionStatus = z.infer<typeof workspaceHostActionStatusSchema>;

export const workspaceHostActionViewSchema = z.object({
  operationId: z.string(),
  status: workspaceHostActionStatusSchema,
  updatedAt: z.number().int(),
  error: workspaceHostActionErrorSchema.optional(),
});
export type WorkspaceHostActionView = z.infer<typeof workspaceHostActionViewSchema>;

export const initializeWorkspaceRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type InitializeWorkspaceRequest = z.infer<typeof initializeWorkspaceRequestSchema>;

export const initializeWorkspaceResultSchema = z.object({
  active: z.literal(true),
});
export type InitializeWorkspaceResult = z.infer<typeof initializeWorkspaceResultSchema>;
