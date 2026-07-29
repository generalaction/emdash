import { ok } from '@emdash/shared';
import type * as Wire from '@emdash/wire';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitAndFollowWorkspaceOperation } from './operation-log';

const mocks = vi.hoisted(() => ({
  createLiveModelReplica: vi.fn(),
}));

vi.mock('@emdash/wire', async (importOriginal) => {
  const original = await importOriginal<typeof Wire>();
  return {
    ...original,
    createLiveModelReplica: mocks.createLiveModelReplica,
  };
});

describe('submitAndFollowWorkspaceOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(mocks.createLiveModelReplica).not.toHaveBeenCalled();
  });

  it('fails instead of hanging when an observed record disappears', async () => {
    let onListChange!: (records: Record<string, unknown>) => void;
    mocks.createLiveModelReplica.mockImplementation((_contract, _model, options) => {
      onListChange = options.onChange.list;
      return {
        acquire: () => ({
          ready: async () => ({
            states: {
              list: {
                snapshot: async () => ({
                  data: {
                    'request-1': { requestId: 'request-1', status: 'pending' },
                  },
                }),
              },
            },
          }),
          release: vi.fn(async () => {}),
        }),
        dispose: vi.fn(async () => {}),
      };
    });
    const client = {
      operationLog: {},
      submitOperation: vi.fn(async () => {
        queueMicrotask(() => onListChange({}));
        return ok({ requestId: 'request-1', seq: 1, outcome: 'duplicate' });
      }),
      cancelOperation: vi.fn(),
    };

    await expect(
      submitAndFollowWorkspaceOperation(client as never, { requestId: 'request-1' } as never)
    ).resolves.toEqual({
      success: false,
      error: { type: 'not-found', message: 'Workspace operation record disappeared' },
    });
  });
});
