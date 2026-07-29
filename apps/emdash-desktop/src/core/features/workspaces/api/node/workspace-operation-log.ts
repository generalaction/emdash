import {
  workspaceContract,
  type WorkspaceContract,
  type WorkspaceError,
} from '@emdash/core/runtimes/workspace/api';
import {
  isTerminalStatus,
  type SubmitWorkspaceOperationInput,
  type WorkspaceOperationRecord,
  type WorkspaceOperationRecordMap,
  type WorkspaceOperationRecordResult,
} from '@emdash/core/runtimes/workspace/api';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveModelReplica } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';

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
  let settled = false;
  let terminalResolve!: (record: WorkspaceOperationRecord) => void;
  const terminal = new Promise<WorkspaceOperationRecord>((resolve) => {
    terminalResolve = resolve;
  });

  const replica = createLiveModelReplica(workspaceContract.operationLog, client.operationLog, {
    onChange: {
      list: (list: WorkspaceOperationRecordMap) => {
        const record = list[request.requestId];
        if (!record || settled) return;
        if (record.stages) options.onProgress?.(record.stages);
        options.onWaitingChange?.(record.status === 'pending');
        if (isTerminalStatus(record.status)) {
          settled = true;
          terminalResolve(record);
        }
      },
    },
  });
  const lease = replica.acquire({});
  const cancel = () => {
    void client.cancelOperation({ requestId: request.requestId });
  };
  options.signal?.addEventListener('abort', cancel, { once: true });

  try {
    const model = await lease.ready();
    const snapshot = await model.states.list.snapshot();
    const records = snapshot.data as WorkspaceOperationRecordMap;
    const existing = records[request.requestId];
    if (existing && isTerminalStatus(existing.status)) {
      settled = true;
      terminalResolve(existing);
    }

    const submitted = await client.submitOperation(request);
    if (!submitted.success) return err(submitted.error);

    const record = await terminal;
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
