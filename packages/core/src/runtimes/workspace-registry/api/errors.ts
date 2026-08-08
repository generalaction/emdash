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

/**
 * A failed removal's error detail carries the same host-decided facts the record's
 * `lastRemovalAttempt` annotation does — stage and failure class (ADR 0006). The
 * return stays loop control: the reconcile sweep reads the class to decide backoff
 * vs a durable terminal stop without waiting on mirror sync; it carries nothing the
 * record does not.
 */
const removeFailedErrorSchema = z.object({
  type: z.literal('remove-failed'),
  /** Removal step that failed: 'teardown' | 'remove' | 'unregister'. */
  stage: z.string(),
  /** Host-decided: 'transient' rides silent sweep retries, 'terminal' needs the user. */
  class: z.enum(['transient', 'terminal']),
  message: z.string(),
});

/**
 * Deletes are idempotent — an absent id is success, like conversations. The one
 * failure mode is a failing teardown (a removal stage, ADR 0006): the record stays
 * registered, annotated with lastRemovalAttempt, so the delete is retryable.
 */
export const deleteWorkspaceErrorSchema = removeFailedErrorSchema;
export type DeleteWorkspaceError = z.infer<typeof deleteWorkspaceErrorSchema>;

export const deleteWorktreeErrorSchema = z.discriminatedUnion('type', [
  /** Worktree records only; unregistering other kinds is deleteWorkspace's job. */
  z.object({ type: z.literal('not-a-worktree'), workspaceId: z.string() }),
  /** Artifact removal failed; the record stays registered so the delete is retryable. */
  removeFailedErrorSchema,
]);
export type DeleteWorktreeError = z.infer<typeof deleteWorktreeErrorSchema>;

export const activateWorkspaceErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace-not-found'), workspaceId: z.string() }),
  /** The record survives as observedStatus 'missing' but there is nothing to prepare. */
  z.object({ type: z.literal('workspace-missing'), workspaceId: z.string() }),
]);
export type ActivateWorkspaceError = z.infer<typeof activateWorkspaceErrorSchema>;

/**
 * updateWorktree's outcomes: each guard refusal is a distinct machine-readable fact,
 * and nothing moves in any refusal case. 'stage-failed' tags execution failures
 * (inspect | fetch | merge) the way createWorktree's stage failures do.
 */
export const updateWorktreeErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace-not-found'), workspaceId: z.string() }),
  z.object({ type: z.literal('not-a-worktree'), workspaceId: z.string() }),
  z.object({ type: z.literal('workspace-missing'), workspaceId: z.string() }),
  /** Live sessions under the worktree: a checkout never moves under an active session. */
  z.object({ type: z.literal('workspace-active'), workspaceId: z.string() }),
  /** Uncommitted changes (untracked included): the update never risks local work. */
  z.object({ type: z.literal('worktree-dirty'), workspaceId: z.string() }),
  /** Local commits the fetched head lacks: fast-forward impossible — resolve manually. */
  z.object({ type: z.literal('diverged'), workspaceId: z.string(), message: z.string() }),
  z.object({ type: z.literal('stage-failed'), stage: z.string(), message: z.string() }),
]);
export type UpdateWorktreeError = z.infer<typeof updateWorktreeErrorSchema>;

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
