import { hostFileRefSchema } from '@primitives/path/api';
import { z } from 'zod';

const nonBlankStringSchema = z.string().trim().min(1);

export const workspaceProvisioningGitRemoteSchema = z.object({
  name: nonBlankStringSchema,
  url: nonBlankStringSchema,
});

export const workspaceProvisioningGitBranchRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    branch: nonBlankStringSchema,
    remote: workspaceProvisioningGitRemoteSchema.optional(),
  }),
  z.object({
    type: z.literal('remote'),
    branch: nonBlankStringSchema,
    remote: workspaceProvisioningGitRemoteSchema,
  }),
]);

export const worktreeProvisioningConfigSchema = z.object({
  kind: z.literal('worktree'),
  repository: hostFileRefSchema,
  preservePatterns: z.array(nonBlankStringSchema),
  git: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create-branch'),
      fromBranch: workspaceProvisioningGitBranchRefSchema,
      pushRemote: nonBlankStringSchema.nullable(),
    }),
    z.object({
      kind: z.literal('use-branch'),
      branchName: nonBlankStringSchema,
    }),
  ]),
});

export const directoryProvisioningConfigSchema = z.object({
  kind: z.literal('directory'),
  path: hostFileRefSchema,
});

export const workspaceProvisioningConfigSchema = z.discriminatedUnion('kind', [
  worktreeProvisioningConfigSchema,
  directoryProvisioningConfigSchema,
]);

export const workspaceProvisioningInputSchema = z.object({
  workspace: workspaceProvisioningConfigSchema,
  generatedName: nonBlankStringSchema,
});

export const workspaceProvisioningProgressSchema = z.object({
  operationId: nonBlankStringSchema,
  kind: nonBlankStringSchema,
  stages: z.array(
    z.object({
      id: nonBlankStringSchema,
      label: nonBlankStringSchema,
      status: z.enum(['pending', 'running', 'done', 'skipped', 'failed']),
      progress: z
        .object({
          percent: z.number().min(0).max(100).optional(),
          message: z.string().optional(),
        })
        .optional(),
    })
  ),
});

export const workspaceProvisioningResultSchema = z.object({
  workspace: hostFileRefSchema,
  branchName: nonBlankStringSchema.nullable(),
});

export const workspaceProvisioningErrorSchema = z.object({
  type: nonBlankStringSchema,
  message: nonBlankStringSchema,
  stageId: z.string().optional(),
  holders: z.array(z.string()).optional(),
  resolutions: z.array(z.string()).optional(),
});

export type WorkspaceProvisioningGitRemote = z.infer<typeof workspaceProvisioningGitRemoteSchema>;
export type WorkspaceProvisioningGitBranchRef = z.infer<
  typeof workspaceProvisioningGitBranchRefSchema
>;
export type WorktreeProvisioningConfig = z.infer<typeof worktreeProvisioningConfigSchema>;
export type DirectoryProvisioningConfig = z.infer<typeof directoryProvisioningConfigSchema>;
export type WorkspaceProvisioningConfig = z.infer<typeof workspaceProvisioningConfigSchema>;
export type WorkspaceProvisioningInput = z.infer<typeof workspaceProvisioningInputSchema>;
export type WorkspaceProvisioningProgress = z.infer<typeof workspaceProvisioningProgressSchema>;
export type WorkspaceProvisioningResult = z.infer<typeof workspaceProvisioningResultSchema>;
export type WorkspaceProvisioningError = z.infer<typeof workspaceProvisioningErrorSchema>;
