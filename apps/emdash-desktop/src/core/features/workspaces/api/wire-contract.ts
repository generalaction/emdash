import {
  operationMutationErrorSchema,
  operationMutationResultSchema,
} from '@emdash/core/primitives/operations/api';
import {
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

export const workspaceSliceErrorSchema = z.union([runtimeResolveErrorSchema, workspaceErrorSchema]);

export const provisionWorkspaceByIdInputSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string().optional(),
  operationId: z.string().optional(),
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
  provision: liveJob({
    input: provisionWorkspaceByIdInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: workspaceProvisionResultSchema,
    error: workspaceSliceErrorSchema,
  }),
  reprovision: fallible({
    input: workspaceIdInputSchema,
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
  }),
  removeAndReprovision: fallible({
    input: workspaceIdInputSchema,
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
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
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
  }),
  archive: fallible({
    input: archiveWorkspaceInputSchema,
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
  }),
});

export type WorkspaceBootstrapStep = z.infer<typeof workspaceBootstrapStepSchema>;
export type WorkspaceBootstrapProgress = z.infer<typeof workspaceBootstrapProgressSchema>;
export type WorkspaceProvisionResult = z.infer<typeof workspaceProvisionResultSchema>;
export type WorkspaceRuntimeState = z.infer<typeof workspaceRuntimeStateSchema>;
export type WorkspaceSliceError = z.infer<typeof workspaceSliceErrorSchema>;
export type WorkspacesWireContract = typeof workspacesWireContract;
