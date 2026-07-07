import { z } from 'zod';

export const gitRemoteSchema = z.object({
  name: z.string(),
  url: z.string(),
});
export type GitRemote = z.infer<typeof gitRemoteSchema>;

export const gitLocalBranchRefSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
});
export type GitLocalBranchRef = z.infer<typeof gitLocalBranchRefSchema>;

export const gitRemoteBranchRefSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
});
export type GitRemoteBranchRef = z.infer<typeof gitRemoteBranchRefSchema>;

export const gitBranchRefSchema = z.union([gitLocalBranchRefSchema, gitRemoteBranchRefSchema]);
export type GitBranchRef = z.infer<typeof gitBranchRefSchema>;

const localBranchSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
  oid: z.string(),
  divergence: z.object({ ahead: z.number().int(), behind: z.number().int() }).optional(),
});
export type LocalBranch = z.infer<typeof localBranchSchema>;

const remoteBranchSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
  oid: z.string(),
});
export type RemoteBranch = z.infer<typeof remoteBranchSchema>;

export const gitBranchSchema = z.union([localBranchSchema, remoteBranchSchema]);
export type GitBranch = z.infer<typeof gitBranchSchema>;

export const gitTagSchema = z.object({
  name: z.string(),
  oid: z.string(),
  message: z.string().optional(),
});
export type GitTag = z.infer<typeof gitTagSchema>;

export const gitRefsModelSchema = z.object({
  branches: z.array(gitBranchSchema),
  tags: z.array(gitTagSchema),
});
export type GitRefsModel = z.infer<typeof gitRefsModelSchema>;
