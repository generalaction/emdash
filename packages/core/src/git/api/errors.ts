import { resultSchema as result } from '@emdash/shared';
import { z } from 'zod';

export const gitCommandErrorSchema = z.object({
  type: z.literal('git_error'),
  message: z.string(),
  stderr: z.string().optional(),
});
export type GitCommandError = z.infer<typeof gitCommandErrorSchema>;

export const cloneRepositoryErrorSchema = z.union([
  z.object({ type: z.literal('target_exists'), path: z.string(), message: z.string() }),
  z.object({ type: z.literal('auth_required'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('remote_not_found'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type CloneRepositoryError = z.infer<typeof cloneRepositoryErrorSchema>;

export const ensureRepositoryErrorSchema = z.union([
  z.object({ type: z.literal('not-repository'), path: z.string() }),
  z.object({ type: z.literal('inspect-failed'), path: z.string(), message: z.string() }),
  z.object({ type: z.literal('init-failed'), path: z.string(), message: z.string() }),
]);
export type EnsureRepositoryError = z.infer<typeof ensureRepositoryErrorSchema>;

export const fetchErrorSchema = z.union([
  z.object({ type: z.literal('no_remote'), message: z.string().optional() }),
  z.object({
    type: z.literal('remote_not_found'),
    remote: z.string().optional(),
    message: z.string(),
  }),
  z.object({ type: z.literal('auth_required'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type FetchError = z.infer<typeof fetchErrorSchema>;

export const commitErrorSchema = z.union([
  z.object({ type: z.literal('nothing_to_commit'), message: z.string() }),
  z.object({ type: z.literal('empty_message'), message: z.string() }),
  z.object({ type: z.literal('hook_failed'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type CommitError = z.infer<typeof commitErrorSchema>;

export const pushErrorSchema = z.union([
  z.object({ type: z.literal('no_remote'), message: z.string().optional() }),
  z.object({ type: z.literal('no_upstream'), message: z.string() }),
  z.object({ type: z.literal('rejected'), message: z.string() }),
  z.object({ type: z.literal('auth_required'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  z.object({ type: z.literal('hook_rejected'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type PushError = z.infer<typeof pushErrorSchema>;

export const pullErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('no_upstream'), message: z.string() }),
  z.object({ type: z.literal('diverged'), message: z.string() }),
  z.object({ type: z.literal('auth_required'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type PullError = z.infer<typeof pullErrorSchema>;

export const syncErrorSchema = z.union([pullErrorSchema, pushErrorSchema]);
export type SyncError = z.infer<typeof syncErrorSchema>;

// createBranchError nests fetchError recursively
export const createBranchErrorSchema = z.union([
  z.object({ type: z.literal('already_exists'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('invalid_name'), branch: z.string(), message: z.string() }),
  z.object({
    type: z.literal('invalid_base'),
    branch: z.string(),
    from: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('fetch_failed'),
    remote: z.string(),
    branch: z.string(),
    error: fetchErrorSchema,
  }),
  gitCommandErrorSchema,
]);
export type CreateBranchError = z.infer<typeof createBranchErrorSchema>;

export const fetchPrForReviewErrorSchema = z.union([
  z.object({ type: z.literal('not_found'), prNumber: z.number().int(), message: z.string() }),
  z.object({ type: z.literal('auth_required'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type FetchPrForReviewError = z.infer<typeof fetchPrForReviewErrorSchema>;

export const deleteBranchErrorSchema = z.union([
  z.object({ type: z.literal('not_found'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('not_merged'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('is_current'), branch: z.string(), message: z.string() }),
  gitCommandErrorSchema,
]);
export type DeleteBranchError = z.infer<typeof deleteBranchErrorSchema>;

export const mergeErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('already_up_to_date'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type MergeError = z.infer<typeof mergeErrorSchema>;

export const rebaseErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('nothing_to_rebase'), message: z.string() }),
  gitCommandErrorSchema,
]);
export type RebaseError = z.infer<typeof rebaseErrorSchema>;

export const switchErrorSchema = z.union([
  z.object({ type: z.literal('local_changes'), message: z.string() }),
  z.object({ type: z.literal('not_found'), ref: z.string(), message: z.string() }),
  gitCommandErrorSchema,
]);
export type SwitchError = z.infer<typeof switchErrorSchema>;

/** result(void, gitCommandError) — for mutations with no payload on success. */
export const gitVoidResultSchema = result(z.void(), gitCommandErrorSchema);

/** result({ output }, pushError) — for push/publishBranch where stdout matters. */
export const gitOutputResultSchema = result(z.object({ output: z.string() }), pushErrorSchema);
