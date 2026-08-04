import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  workspaceHostErrorSchema,
  workspaceHostOperationInputSchema,
  workspaceHostOperationQuerySchema,
  workspaceHostOperationViewSchema,
  workspaceHostOperationsListSchema,
  workspaceHostRepoSnapshotSchema,
  workspaceHostSnapshotRequestSchema,
  workspaceHostSubmitOperationResultSchema,
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
  operations: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceHostOperationsListSchema }),
    },
  }),
});

export type WorkspaceHostContract = typeof workspaceHostContract;
