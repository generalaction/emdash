import {
  bootstrapRepositoryInitializeSchema,
  cleanWorkspaceArtifactsResultSchema,
  workspaceOperationResultSchema,
  workspaceStateSchema,
  workspaceUsageSchema,
  workspaceErrorSchema,
  workspaceOperationProgressSchema,
} from '@emdash/core/runtimes/workspace/api';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire';
import z from 'zod';
import {
  deletionListSchema,
  deletionModelKeySchema,
  deletionMutationErrorSchema,
  deletionMutationResultSchema,
} from '@core/primitives/operations/api';

export const workspaceBootstrapStepSchema = z.enum([
  'resolving-worktree',
  'initialising-workspace',
  'running-provision-script',
  'connecting',
  'setting-up-workspace',
  'starting-sessions',
]);

export const workspaceBootstrapProgressSchema = z.object({
  step: workspaceBootstrapStepSchema,
  message: z.string(),
  operation: workspaceOperationProgressSchema.optional(),
});

export const workspaceProvisionResultSchema = z.object({
  path: z.string(),
  workspaceId: z.string(),
  sshConnectionId: z.string().optional(),
});

export const workspaceCloneProvisionResultSchema = z.object({
  path: z.string(),
});

export const workspaceSliceErrorSchema = z.union([runtimeResolveErrorSchema, workspaceErrorSchema]);

export const workspaceBootstrapStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unprovisioned'),
  }),
  z.object({
    status: z.literal('provisioning'),
    progress: workspaceBootstrapProgressSchema.optional(),
  }),
  z.object({
    status: z.literal('ready'),
    result: workspaceProvisionResultSchema,
  }),
  z.object({
    status: z.literal('error'),
    progress: workspaceBootstrapProgressSchema.optional(),
    error: workspaceSliceErrorSchema,
  }),
]);

export const workspaceBootstrapKeySchema = z.object({
  workspaceId: z.string(),
});

export const provisionWorkspaceByIdInputSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string().optional(),
});

export const provisionCloneWorkspaceInputSchema = z.object({
  url: z.string().min(1),
  destination: z.string().min(1),
  remoteName: z.string().min(1).optional(),
  depth: z.number().int().positive().optional(),
  initialize: bootstrapRepositoryInitializeSchema.optional(),
});

const workspaceIdInputSchema = z.object({
  workspaceId: z.string(),
});

export const workspaceRuntimeStateSchema = workspaceStateSchema;

export const workspaceRuntimeOperationResultSchema = workspaceOperationResultSchema
  .omit({ workspace: true })
  .extend({ workspaceId: z.string() });

export const workspaceRuntimeUsageSchema = workspaceUsageSchema
  .omit({ workspace: true })
  .extend({ workspaceId: z.string() });

export const workspaceRuntimeCleanResultSchema = cleanWorkspaceArtifactsResultSchema
  .omit({ workspace: true })
  .extend({ workspaceId: z.string() });

export const activateWorkspaceByIdInputSchema = workspaceIdInputSchema.extend({
  consumerId: z.string().min(1),
});

export const deactivateWorkspaceByIdInputSchema = activateWorkspaceByIdInputSchema.extend({
  strategy: z.enum(['stop', 'detach']),
});

export const teardownWorkspaceByIdInputSchema = workspaceIdInputSchema.extend({
  force: z.boolean().default(false),
});

export const cleanWorkspaceArtifactsByIdInputSchema = workspaceIdInputSchema.extend({
  preservePatterns: z.array(z.string()).default([]),
});

export const archiveWorkspaceInputSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string().optional(),
  workspacePath: z.string().min(1),
  branchName: z.string().optional(),
});

export const workspacesWireContract = defineContract({
  runtime: liveModel({
    key: workspaceIdInputSchema,
    states: {
      state: liveState({ data: workspaceRuntimeStateSchema }),
    },
  }),
  bootstrap: liveModel({
    key: workspaceBootstrapKeySchema,
    states: {
      state: liveState({ data: workspaceBootstrapStateSchema }),
    },
  }),
  provision: liveJob({
    input: provisionWorkspaceByIdInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: workspaceProvisionResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  provisionClone: liveJob({
    input: provisionCloneWorkspaceInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: workspaceCloneProvisionResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  activate: liveJob({
    input: activateWorkspaceByIdInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceRuntimeOperationResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  deactivate: liveJob({
    input: deactivateWorkspaceByIdInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceRuntimeOperationResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  teardown: liveJob({
    input: teardownWorkspaceByIdInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceRuntimeOperationResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  cleanArtifacts: liveJob({
    input: cleanWorkspaceArtifactsByIdInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceRuntimeCleanResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  reconcile: fallible({
    input: workspaceIdInputSchema,
    data: workspaceRuntimeOperationResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  measureUsage: fallible({
    input: workspaceIdInputSchema,
    data: workspaceRuntimeUsageSchema,
    error: workspaceSliceErrorSchema,
  }),
  delete: fallible({
    input: workspaceIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  archive: fallible({
    input: archiveWorkspaceInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  retryDelete: fallible({
    input: workspaceIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  forgetWithoutCleanup: fallible({
    input: workspaceIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  deletions: liveModel({
    key: deletionModelKeySchema,
    states: {
      list: liveState({ data: deletionListSchema }),
    },
  }),
});

export type WorkspaceBootstrapStep = z.infer<typeof workspaceBootstrapStepSchema>;
export type WorkspaceBootstrapProgress = z.infer<typeof workspaceBootstrapProgressSchema>;
export type WorkspaceProvisionResult = z.infer<typeof workspaceProvisionResultSchema>;
export type WorkspaceCloneProvisionResult = z.infer<typeof workspaceCloneProvisionResultSchema>;
export type WorkspaceBootstrapState = z.infer<typeof workspaceBootstrapStateSchema>;
export type WorkspaceRuntimeState = z.infer<typeof workspaceRuntimeStateSchema>;
export type WorkspaceSliceError = z.infer<typeof workspaceSliceErrorSchema>;
export type WorkspacesWireContract = typeof workspacesWireContract;
