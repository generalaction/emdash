import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire';
import {
  activateWorkspaceInputSchema,
  convertWorkspaceInputSchema,
  deactivateWorkspaceInputSchema,
  provisionWorkspaceInputSchema,
  reconcileWorkspaceInputSchema,
  teardownWorkspaceInputSchema,
  workspaceErrorSchema,
  workspaceKeySchema,
  workspaceOperationProgressSchema,
  workspaceOperationResultSchema,
  workspaceStateSchema,
} from './schemas';

export const workspaceContract = defineContract({
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
});

export type WorkspaceContract = typeof workspaceContract;
