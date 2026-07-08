import { z } from 'zod';

export const bootstrapGitRemoteSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
});

export const bootstrapGitBranchRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    branch: z.string().min(1),
    remote: bootstrapGitRemoteSchema.optional(),
  }),
  z.object({
    type: z.literal('remote'),
    branch: z.string().min(1),
    remote: bootstrapGitRemoteSchema,
  }),
]);

export const bootstrapGitIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('use-branch'),
    branchName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('create-branch'),
    branchName: z.string().min(1),
    fromBranch: bootstrapGitBranchRefSchema,
    pushBranch: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('pr-branch'),
    prNumber: z.number().int().positive(),
    headBranch: z.string().min(1),
    headRepositoryUrl: z.string().min(1),
    isFork: z.boolean(),
    taskBranch: z.string().min(1).optional(),
    pushBranch: z.boolean().optional(),
  }),
]);

export type BootstrapGitRemote = z.infer<typeof bootstrapGitRemoteSchema>;
export type BootstrapGitBranchRef = z.infer<typeof bootstrapGitBranchRefSchema>;
export type BootstrapGitIntent = z.infer<typeof bootstrapGitIntentSchema>;
