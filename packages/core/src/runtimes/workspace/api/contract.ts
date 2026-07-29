import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { workspaceProvisioningDefinitions } from '@services/workspace-provisioning/api';
import { z } from 'zod';
import {
  cancelWorkspaceOperationInputSchema,
  cancelWorkspaceOperationResultSchema,
  submitWorkspaceOperationInputSchema,
  submitWorkspaceOperationOutcomeSchema,
  workspaceOperationRecordMapSchema,
} from './operation-records';
import {
  measureWorkspaceUsageInputSchema,
  reconcileWorkspaceInputSchema,
  workspaceUsageSchema,
  workspaceErrorSchema,
  workspaceKeySchema,
  workspaceOperationResultSchema,
  workspaceStateSchema,
} from './schemas';

export const workspaceContract = defineContract({
  ...workspaceProvisioningDefinitions,
  workspace: liveModel({
    key: workspaceKeySchema,
    states: {
      state: liveState({ data: workspaceStateSchema }),
    },
  }),
  reconcile: fallible({
    input: reconcileWorkspaceInputSchema,
    data: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  measureUsage: fallible({
    input: measureWorkspaceUsageInputSchema,
    data: workspaceUsageSchema,
    error: workspaceErrorSchema,
  }),
  submitOperation: fallible({
    input: submitWorkspaceOperationInputSchema,
    data: submitWorkspaceOperationOutcomeSchema,
    error: workspaceErrorSchema,
  }),
  cancelOperation: fallible({
    input: cancelWorkspaceOperationInputSchema,
    data: cancelWorkspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  operationLog: liveModel({
    key: z.object({}),
    states: {
      list: liveState({ data: workspaceOperationRecordMapSchema }),
    },
  }),
});

export type WorkspaceContract = typeof workspaceContract;
