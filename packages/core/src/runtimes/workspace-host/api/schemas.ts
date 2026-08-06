import { hostAbsolutePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const workspaceHostErrorSchema = z.object({
  type: z.enum([
    'git-command-failed',
    'filesystem-error',
    'operation-rejected',
    'runtime-unavailable',
  ]),
  message: z.string(),
  code: z.string().optional(),
});
export type WorkspaceHostError = z.infer<typeof workspaceHostErrorSchema>;

export const workspaceHostNoticeScriptSchema = z.enum(['prepare', 'setup', 'run', 'teardown']);
export type WorkspaceHostNoticeScript = z.infer<typeof workspaceHostNoticeScriptSchema>;

export const workspaceHostNoticeSchema = z.object({
  path: hostAbsolutePathSchema,
  script: workspaceHostNoticeScriptSchema,
  status: z.enum(['failed', 'timed-out', 'cancelled']),
  message: z.string(),
  exitCode: z.number().int().optional(),
  outputTail: z.string(),
  at: z.number().int(),
});
export type WorkspaceHostNotice = z.infer<typeof workspaceHostNoticeSchema>;

export const workspaceHostNoticesListSchema = z.record(
  z.string(),
  z.array(workspaceHostNoticeSchema)
);
export type WorkspaceHostNoticesList = z.infer<typeof workspaceHostNoticesListSchema>;

export const workspaceHostInitializeRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type WorkspaceHostInitializeRequest = z.infer<typeof workspaceHostInitializeRequestSchema>;

export const workspaceHostRunScriptResultSchema = z.object({
  status: z.enum(['succeeded', 'skipped', 'failed', 'timed-out', 'cancelled']),
  message: z.string().optional(),
  exitCode: z.number().int().optional(),
  outputTail: z.string(),
});
export type WorkspaceHostRunScriptResult = z.infer<typeof workspaceHostRunScriptResultSchema>;

export const workspaceHostInitializeResultSchema = z.object({
  active: z.literal(true),
  prepare: workspaceHostRunScriptResultSchema,
  notices: z.array(workspaceHostNoticeSchema),
});
export type WorkspaceHostInitializeResult = z.infer<typeof workspaceHostInitializeResultSchema>;

export const workspaceHostRunScriptRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
  script: z.enum(['prepare', 'setup', 'run', 'teardown']),
});
export type WorkspaceHostRunScriptRequest = z.infer<typeof workspaceHostRunScriptRequestSchema>;

export const workspaceHostMeasureUsageRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type WorkspaceHostMeasureUsageRequest = z.infer<
  typeof workspaceHostMeasureUsageRequestSchema
>;

export const workspaceHostUsageErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type WorkspaceHostUsageError = z.infer<typeof workspaceHostUsageErrorSchema>;

export const workspaceHostUsageSchema = z.object({
  path: hostAbsolutePathSchema,
  /** Exclusive disk bytes for the workspace tree. */
  totalBytes: z.number().int().nonnegative(),
  /** Disk bytes attributable to git-ignored artifacts (reclaimable). */
  artifactBytes: z.number().int().nonnegative(),
  errors: z.array(workspaceHostUsageErrorSchema),
});
export type WorkspaceHostUsage = z.infer<typeof workspaceHostUsageSchema>;
