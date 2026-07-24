import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire';
import { workspaceProvisioningDefinitions } from '@services/workspace-provisioning/api';
import {
  activateWorkspaceInputSchema,
  cleanWorkspaceArtifactsInputSchema,
  cleanWorkspaceArtifactsResultSchema,
  convertWorkspaceInputSchema,
  deactivateWorkspaceInputSchema,
  measureWorkspaceUsageInputSchema,
  provisionWorkspaceInputSchema,
  reconcileWorkspaceInputSchema,
  teardownWorkspaceInputSchema,
  workspaceUsageSchema,
  workspaceErrorSchema,
  workspaceKeySchema,
  workspaceOperationProgressSchema,
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
  provision: liveJob({
    input: provisionWorkspaceInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  convert: liveJob({
    input: convertWorkspaceInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  activate: liveJob({
    input: activateWorkspaceInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  deactivate: liveJob({
    input: deactivateWorkspaceInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  teardown: liveJob({
    input: teardownWorkspaceInputSchema,
    progress: workspaceOperationProgressSchema,
    result: workspaceOperationResultSchema,
    error: workspaceErrorSchema,
  }),
  cleanArtifacts: liveJob({
    input: cleanWorkspaceArtifactsInputSchema,
    progress: workspaceOperationProgressSchema,
    result: cleanWorkspaceArtifactsResultSchema,
    error: workspaceErrorSchema,
  }),
});

export type WorkspaceContract = typeof workspaceContract;
