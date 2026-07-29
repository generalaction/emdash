import { err, ok, type Result } from '@emdash/shared';
import { createLiveModelReplica } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { workspaceContract, type WorkspaceContract } from './contract';
import {
  isTerminalStatus,
  type SubmitWorkspaceOperationInput,
  type WorkspaceOperationRecord,
  type WorkspaceOperationRecordMap,
  type WorkspaceOperationRecordResult,
} from './operation-records';
import type { WorkspaceError } from './schemas';

export type SubmitAndFollowWorkspaceOperationOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: NonNullable<WorkspaceOperationRecord['stages']>) => void;
  onWaitingChange?: (waiting: boolean) => void;
};

export async function submitAndFollowWorkspaceOperation(
  client: ContractClient<WorkspaceContract>,
  request: SubmitWorkspaceOperationInput,
  options: SubmitAndFollowWorkspaceOperationOptions = {}
): Promise<Result<WorkspaceOperationRecordResult['data'], WorkspaceError>> {
  if (options.signal?.aborted) return err(cancelledError());

  let settled = false;
  let observed = false;
  let aborted = false;
  let terminalResolve!: (outcome: FollowOutcome) => void;
  const terminal = new Promise<FollowOutcome>((resolve) => {
    terminalResolve = resolve;
  });

  const replica = createLiveModelReplica(workspaceContract.operationLog, client.operationLog, {
    onChange: {
      list: (value) => {
        const list = value as unknown as WorkspaceOperationRecordMap;
        const record = list[request.requestId];
        if (settled) return;
        if (!record) {
          if (observed) {
            settled = true;
            terminalResolve({
              kind: 'error',
              error: { type: 'not-found', message: 'Workspace operation record disappeared' },
            });
          }
          return;
        }
        observed = true;
        if (record.stages) options.onProgress?.(record.stages);
        options.onWaitingChange?.(record.status === 'pending');
        if (isTerminalStatus(record.status)) {
          settled = true;
          terminalResolve({ kind: 'record', record });
        }
      },
    },
  });
  const lease = replica.acquire({});
  const cancel = () => {
    aborted = true;
    void client.cancelOperation({ requestId: request.requestId });
  };
  options.signal?.addEventListener('abort', cancel, { once: true });

  try {
    const model = await lease.ready();
    const snapshot = await model.states.list.snapshot();
    // The replica snapshot currently loses the live-state data generic at this boundary.
    const records = snapshot.data as WorkspaceOperationRecordMap;
    const existing = records[request.requestId];
    if (existing) observed = true;
    if (existing && isTerminalStatus(existing.status)) {
      settled = true;
      terminalResolve({ kind: 'record', record: existing });
    }

    if (options.signal?.aborted) return err(cancelledError());

    const submitted = await client.submitOperation(request);
    if (!submitted.success) return err(submitted.error);
    if (options.signal?.aborted || aborted) {
      await client.cancelOperation({ requestId: request.requestId });
    }

    const outcome = await terminal;
    if (outcome.kind === 'error') return err(outcome.error);
    const { record } = outcome;
    if (record.status === 'succeeded' && record.result) {
      return ok(record.result.data);
    }
    return err(
      record.error ?? {
        type: record.status,
        message: `Workspace operation ${record.status}`,
      }
    );
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await lease.release();
    await replica.dispose();
  }
}

type FollowOutcome =
  | { kind: 'record'; record: WorkspaceOperationRecord }
  | { kind: 'error'; error: WorkspaceError };

function cancelledError(): WorkspaceError {
  return { type: 'cancelled', message: 'Workspace operation was cancelled' };
}
