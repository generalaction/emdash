import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  workspaceHostErrorSchema,
  workspaceHostInitializeRequestSchema,
  workspaceHostInitializeResultSchema,
  workspaceHostMeasureUsageRequestSchema,
  workspaceHostNoticesListSchema,
  workspaceHostOperationInputSchema,
  workspaceHostOperationQuerySchema,
  workspaceHostOperationViewSchema,
  workspaceHostOperationsListSchema,
  workspaceHostRepoSnapshotSchema,
  workspaceHostRunScriptRequestSchema,
  workspaceHostRunScriptResultSchema,
  workspaceHostSnapshotRequestSchema,
  workspaceHostSubmitOperationResultSchema,
  workspaceHostUsageSchema,
} from './schemas';

export const workspaceHostContract = defineContract({
  snapshotRepository: fallible({
    input: workspaceHostSnapshotRequestSchema,
    data: workspaceHostRepoSnapshotSchema,
    error: workspaceHostErrorSchema,
  }),
  submitOperation: fallible({
    input: workspaceHostOperationInputSchema,
    data: workspaceHostSubmitOperationResultSchema,
    error: workspaceHostErrorSchema,
  }),
  getOperation: fallible({
    input: workspaceHostOperationQuerySchema,
    data: workspaceHostOperationViewSchema.nullable(),
    error: workspaceHostErrorSchema,
  }),
  initializeWorkspace: fallible({
    input: workspaceHostInitializeRequestSchema,
    data: workspaceHostInitializeResultSchema,
    error: workspaceHostErrorSchema,
  }),
  runWorkspaceScript: fallible({
    input: workspaceHostRunScriptRequestSchema,
    data: workspaceHostRunScriptResultSchema,
    error: workspaceHostErrorSchema,
  }),
  measureUsage: fallible({
    input: workspaceHostMeasureUsageRequestSchema,
    data: workspaceHostUsageSchema,
    error: workspaceHostErrorSchema,
  }),
  operations: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceHostOperationsListSchema }),
    },
  }),
  notices: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceHostNoticesListSchema }),
    },
  }),
});

export type WorkspaceHostContract = typeof workspaceHostContract;
