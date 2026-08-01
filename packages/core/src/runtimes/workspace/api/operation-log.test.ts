import { ok } from '@emdash/shared';
import { cell, expose } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { workspaceProvisioningContract } from '@services/workspace-provisioning/api';
import { describe, expect, it, vi } from 'vitest';
import { workspaceContract } from './contract';
import { submitAndFollowWorkspaceOperation } from './operation-log';
import type { WorkspaceOperationRecordMap } from './operation-records';

describe('submitAndFollowWorkspaceOperation', () => {
  it('does not submit when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const submitOperation = vi.fn();

    await expect(
      submitAndFollowWorkspaceOperation(
        { submitOperation } as never,
        { requestId: 'request-1' } as never,
        { signal: controller.signal }
      )
    ).resolves.toEqual({
      success: false,
      error: { type: 'cancelled', message: 'Workspace operation was cancelled' },
    });
    expect(submitOperation).not.toHaveBeenCalled();
  });

  it('fails instead of hanging when an observed record disappears', async () => {
    const list = cell<WorkspaceOperationRecordMap>({
      'request-1': { requestId: 'request-1', status: 'pending' },
    } as unknown as WorkspaceOperationRecordMap);
    const operationLog = expose(workspaceContract.operationLog, { list });
    const wire = createTestWire(workspaceProvisioningContract, {
      operationLog,
      submitOperation: vi.fn(async () => {
        queueMicrotask(() => list.set({}));
        return ok({ requestId: 'request-1', seq: 1, outcome: 'duplicate' });
      }),
      cancelOperation: vi.fn(),
    } as never);

    try {
      await expect(
        submitAndFollowWorkspaceOperation(wire.client as never, { requestId: 'request-1' } as never)
      ).resolves.toEqual({
        success: false,
        error: { type: 'not-found', message: 'Workspace operation record disappeared' },
      });
    } finally {
      await operationLog.dispose();
      await wire.dispose();
    }
  });
});
