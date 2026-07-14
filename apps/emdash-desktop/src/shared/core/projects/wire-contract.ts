import { workspaceErrorSchema } from '@emdash/core/runtimes/workspace/api';
import { defineContract, liveJob, liveModel, liveState } from '@emdash/wire';
import z from 'zod';
import { localProjectSchema } from '@shared/projects';
import { workspaceBootstrapProgressSchema } from '../workspaces/wire-contract';

export const projectCreationStateSchema = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('cloning'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('initializing'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('registering'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('ready'),
    project: localProjectSchema,
  }),
  z.object({
    phase: z.literal('error'),
    message: z.string(),
    error: workspaceErrorSchema.optional(),
  }),
]);

export const projectCreationKeySchema = z.object({
  projectId: z.string(),
});

export const createProjectFromRemoteInputSchema = z.object({
  projectId: z.string(),
  mode: z.enum(['clone', 'new']),
  repositoryUrl: z.string().min(1),
  targetPath: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const projectsWireContract = defineContract({
  creation: liveModel({
    key: projectCreationKeySchema,
    states: {
      state: liveState({ data: projectCreationStateSchema }),
    },
  }),
  create: liveJob({
    input: createProjectFromRemoteInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: localProjectSchema,
    error: workspaceErrorSchema,
  }),
});

export type ProjectCreationState = z.infer<typeof projectCreationStateSchema>;
export type CreateProjectFromRemoteInput = z.infer<typeof createProjectFromRemoteInputSchema>;
export type ProjectsWireContract = typeof projectsWireContract;
