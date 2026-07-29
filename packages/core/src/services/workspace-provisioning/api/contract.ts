import type { Result } from '@emdash/shared';
import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import type { HostFileRef } from '@primitives/path/api';
import { z } from 'zod';
import { workspaceProvisioningErrorSchema, type WorkspaceProvisioningError } from './schemas';

export type WorkspaceProvisioningOperationInput = {
  requestId: string;
  kind: string;
  workspace: HostFileRef;
  params: {
    kind: string;
    input: unknown;
  };
};

export type WorkspaceProvisioningOperationOutcome = {
  requestId: string;
  seq: number;
  outcome: 'accepted' | 'duplicate';
};

export type WorkspaceProvisioningCancelInput = {
  requestId: string;
};

export type WorkspaceProvisioningCancelResult = {
  requestId: string;
  status: string;
};

export type WorkspaceProvisioningOperationRecord = {
  requestId: string;
  status: string;
  stages?: unknown;
  result?: { data: unknown };
  error?: WorkspaceProvisioningError;
};

export type WorkspaceProvisioningOperationRecordMap = Record<
  string,
  WorkspaceProvisioningOperationRecord
>;

export type WorkspaceProvisioningOperationClient = {
  submitOperation(
    input: WorkspaceProvisioningOperationInput
  ): Promise<Result<WorkspaceProvisioningOperationOutcome, WorkspaceProvisioningError>>;
  cancelOperation(
    input: WorkspaceProvisioningCancelInput
  ): Promise<Result<WorkspaceProvisioningCancelResult, WorkspaceProvisioningError>>;
};

export const workspaceProvisioningDefinitions = {
  submitOperation: fallible({
    input: z.custom<WorkspaceProvisioningOperationInput>(),
    data: z.custom<WorkspaceProvisioningOperationOutcome>(),
    error: workspaceProvisioningErrorSchema,
  }),
  cancelOperation: fallible({
    input: z.custom<WorkspaceProvisioningCancelInput>(),
    data: z.custom<WorkspaceProvisioningCancelResult>(),
    error: workspaceProvisioningErrorSchema,
  }),
  operationLog: liveModel({
    key: z.object({}),
    states: {
      list: liveState({ data: z.custom<WorkspaceProvisioningOperationRecordMap>() }),
    },
  }),
};

export const workspaceProvisioningContract = defineContract(workspaceProvisioningDefinitions);

export type WorkspaceProvisioningContract = typeof workspaceProvisioningContract;
