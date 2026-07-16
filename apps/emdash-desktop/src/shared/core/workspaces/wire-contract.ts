import {
  bootstrapRepositoryInitializeSchema,
  workspaceErrorSchema,
  workspaceOperationProgressSchema,
} from '@emdash/core/runtimes/workspace/api';
import {
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
  terminalErrorSchema,
} from '@emdash/core/services/script-workflows/api';
import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire';
import z from 'zod';
import {
  deletionListSchema,
  deletionModelKeySchema,
  deletionMutationErrorSchema,
  deletionMutationResultSchema,
} from '@shared/core/operations/deletion';

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
    error: workspaceErrorSchema,
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

export const runWorkspaceScriptWorkflowInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  type: z.enum(['setup', 'run', 'teardown']),
});

const workspaceIdInputSchema = z.object({
  workspaceId: z.string(),
});

export const archiveWorkspaceInputSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string().optional(),
  workspacePath: z.string().min(1),
  branchName: z.string().optional(),
});

export const workspacesWireContract = defineContract({
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
    error: workspaceErrorSchema,
  }),
  provisionClone: liveJob({
    input: provisionCloneWorkspaceInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: workspaceCloneProvisionResultSchema,
    error: workspaceErrorSchema,
  }),
  runScriptWorkflow: liveJob({
    input: runWorkspaceScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
    error: terminalErrorSchema,
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
export type RunWorkspaceScriptWorkflowInput = z.infer<typeof runWorkspaceScriptWorkflowInputSchema>;
export type WorkspaceBootstrapState = z.infer<typeof workspaceBootstrapStateSchema>;
export type WorkspacesWireContract = typeof workspacesWireContract;
