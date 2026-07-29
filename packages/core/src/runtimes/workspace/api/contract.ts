import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { workspaceProvisioningDefinitions } from '@services/workspace-provisioning/api';
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
});

export type WorkspaceContract = typeof workspaceContract;
