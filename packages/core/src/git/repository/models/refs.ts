import { z } from 'zod';

export const gitRemoteSchema = z.object({
  name: z.string(),
  url: z.string(),
});

export const gitLocalBranchRefSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
});

export const gitRemoteBranchRefSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
});

export const gitBranchRefSchema = z.union([gitLocalBranchRefSchema, gitRemoteBranchRefSchema]);

const localBranchSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
  oid: z.string(),
  divergence: z.object({ ahead: z.number().int(), behind: z.number().int() }).optional(),
});

const remoteBranchSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
  oid: z.string(),
});

export const gitBranchSchema = z.union([localBranchSchema, remoteBranchSchema]);

export const gitRefsModelSchema = z.object({
  branches: z.array(gitBranchSchema),
  tags: z.array(z.object({ name: z.string(), oid: z.string(), message: z.string().optional() })),
});
