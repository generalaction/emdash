import { z } from 'zod';
import { workspaceRecordSchema } from './schemas';

export const workspaceNotFoundErrorSchema = z.object({
  type: z.literal('workspace-not-found'),
  workspaceId: z.string(),
});
export type WorkspaceNotFoundError = z.infer<typeof workspaceNotFoundErrorSchema>;

export const createWorkspaceErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('path-not-found'), path: z.string() }),
  /** Carries the existing record so a second desktop adopts it instead of fighting. */
  z.object({ type: z.literal('already-registered'), record: workspaceRecordSchema }),
  z.object({
    type: z.literal('immutable-field-mismatch'),
    workspaceId: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal('inspect-failed'), path: z.string(), message: z.string() }),
]);
export type CreateWorkspaceError = z.infer<typeof createWorkspaceErrorSchema>;

/** Deletes are idempotent — an absent id is success, like conversations. */
export const deleteWorkspaceErrorSchema = z.never();
export type DeleteWorkspaceError = z.infer<typeof deleteWorkspaceErrorSchema>;

export const activateWorkspaceErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace-not-found'), workspaceId: z.string() }),
  /** The record survives as observedStatus 'missing' but there is nothing to prepare. */
  z.object({ type: z.literal('workspace-missing'), workspaceId: z.string() }),
]);
export type ActivateWorkspaceError = z.infer<typeof activateWorkspaceErrorSchema>;

export const createWorktreeErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('repository-not-found'), repositoryId: z.string() }),
  z.object({
    type: z.literal('immutable-field-mismatch'),
    workspaceId: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal('path-conflict'), path: z.string() }),
  /** Stage-tagged execution failure; also recorded durably as lastCreateOutcome. */
  z.object({ type: z.literal('stage-failed'), stage: z.string(), message: z.string() }),
]);
export type CreateWorktreeError = z.infer<typeof createWorktreeErrorSchema>;
