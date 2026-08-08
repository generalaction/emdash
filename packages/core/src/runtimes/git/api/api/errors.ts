import { resultSchema as result } from '@emdash/shared';
import { z } from 'zod';
import { hostAbsolutePathSchema, portableRelativePathSchema } from '#primitives/path/api';

const messageError = <Type extends string>(type: Type) =>
  z.object({ type: z.literal(type), message: z.string() });

export const gitExecErrorCodeSchema = z.enum(['stale_ref_update']);
export type GitExecErrorCode = z.infer<typeof gitExecErrorCodeSchema>;

export const gitExecErrorSchema = z.object({
  type: z.literal('git_error'),
  code: gitExecErrorCodeSchema.optional(),
  message: z.string(),
  stderr: z.string().optional(),
});
export type GitExecError = z.infer<typeof gitExecErrorSchema>;

export const gitResolutionErrorSchema = z.object({
  type: z.literal('resolution_failed'),
  path: hostAbsolutePathSchema,
  message: z.string(),
});
export type GitResolutionError = z.infer<typeof gitResolutionErrorSchema>;

export const gitCommandErrorSchema = z.union([gitExecErrorSchema, gitResolutionErrorSchema]);
export type GitCommandError = z.infer<typeof gitCommandErrorSchema>;

export const authRequiredErrorSchema = messageError('auth_required');
export const authFailedErrorSchema = messageError('auth_failed');
export const networkErrorSchema = messageError('network_error');
export const noRemoteErrorSchema = z.object({
  type: z.literal('no_remote'),
  message: z.string().optional(),
});
export const noUpstreamErrorSchema = messageError('no_upstream');
export const conflictErrorSchema = z.object({
  type: z.literal('conflict'),
  message: z.string(),
  conflictedFiles: z.array(portableRelativePathSchema).optional(),
});

export const cloneRepositoryErrorSchema = z.union([
  z.object({
    type: z.literal('target_exists'),
    path: hostAbsolutePathSchema,
    message: z.string(),
  }),
  authRequiredErrorSchema,
  authFailedErrorSchema,
  networkErrorSchema,
  messageError('remote_not_found'),
  gitCommandErrorSchema,
]);
export type CloneRepositoryError = z.infer<typeof cloneRepositoryErrorSchema>;

export const ensureRepositoryErrorSchema = z.union([
  z.object({ type: z.literal('not-repository'), path: hostAbsolutePathSchema }),
  z.object({
    type: z.literal('inspect-failed'),
    path: hostAbsolutePathSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal('init-failed'),
    path: hostAbsolutePathSchema,
    message: z.string(),
  }),
]);
export type EnsureRepositoryError = z.infer<typeof ensureRepositoryErrorSchema>;

export const fetchErrorSchema = z.union([
  noRemoteErrorSchema,
  z.object({
    type: z.literal('remote_not_found'),
    remote: z.string().optional(),
    message: z.string(),
  }),
  authRequiredErrorSchema,
  authFailedErrorSchema,
  networkErrorSchema,
  gitCommandErrorSchema,
]);
export type FetchError = z.infer<typeof fetchErrorSchema>;

export const commitErrorSchema = z.union([
  messageError('nothing_to_commit'),
  messageError('empty_message'),
  messageError('hook_failed'),
  gitCommandErrorSchema,
]);
export type CommitError = z.infer<typeof commitErrorSchema>;

export const pushErrorSchema = z.union([
  noRemoteErrorSchema,
  noUpstreamErrorSchema,
  messageError('rejected'),
  authRequiredErrorSchema,
  authFailedErrorSchema,
  networkErrorSchema,
  messageError('remote_not_found'),
  messageError('hook_rejected'),
  gitCommandErrorSchema,
]);
export type PushError = z.infer<typeof pushErrorSchema>;

export const pullErrorSchema = z.union([
  conflictErrorSchema,
  noUpstreamErrorSchema,
  messageError('diverged'),
  authRequiredErrorSchema,
  authFailedErrorSchema,
  networkErrorSchema,
  gitCommandErrorSchema,
]);
export type PullError = z.infer<typeof pullErrorSchema>;

export const fetchPrForReviewErrorSchema = z.union([
  z.object({ type: z.literal('not_found'), prNumber: z.number().int(), message: z.string() }),
  authRequiredErrorSchema,
  gitCommandErrorSchema,
]);
export type FetchPrForReviewError = z.infer<typeof fetchPrForReviewErrorSchema>;

export type GitOperationError =
  | CloneRepositoryError
  | EnsureRepositoryError
  | FetchError
  | CommitError
  | PushError
  | PullError
  | FetchPrForReviewError;

export const gitVoidResultSchema = result(z.void(), gitCommandErrorSchema);
export const gitOutputResultSchema = result(z.object({ output: z.string() }), pushErrorSchema);
