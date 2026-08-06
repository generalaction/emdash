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

export const initializeWorkspaceRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type InitializeWorkspaceRequest = z.infer<typeof initializeWorkspaceRequestSchema>;

export const initializeWorkspaceResultSchema = z.object({
  active: z.literal(true),
});
export type InitializeWorkspaceResult = z.infer<typeof initializeWorkspaceResultSchema>;
