import { LOCAL_HOST_REF } from '@primitives/host/api';
import { createMemoryKeyValueStore } from '@primitives/kv/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import {
  createKvWorkspaceOperationRecordStore,
  createMemoryWorkspaceOperationRecordStore,
} from './operation-records';

describe('createKvWorkspaceOperationRecordStore', () => {
  it('appends, lists, updates, replaces, and prunes records', async () => {
    let now = 10;
    const store = createKvWorkspaceOperationRecordStore(createMemoryKeyValueStore(), {
      now: () => now,
    });

    const appended = await store.appendRecord(recordDraft('request-1'));
    expect(appended).toMatchObject({
      success: true,
      data: {
        requestId: 'request-1',
        seq: 1,
        attempt: 0,
        status: 'pending',
        createdAt: 10,
        updatedAt: 10,
      },
    });

    now = 20;
    await expect(
      store.updateRecord('request-1', {
        status: 'failed',
        error: { type: 'failed', message: 'Nope' },
        finishedAt: 20,
      })
    ).resolves.toMatchObject({
      success: true,
      data: {
        requestId: 'request-1',
        status: 'failed',
        updatedAt: 20,
        finishedAt: 20,
      },
    });

    now = 30;
    await expect(store.replaceRecord('request-1', recordDraft('request-1'))).resolves.toMatchObject(
      {
        success: true,
        data: {
          requestId: 'request-1',
          seq: 1,
          attempt: 1,
          status: 'pending',
          createdAt: 10,
          updatedAt: 30,
        },
      }
    );

    now = 40;
    await store.updateRecord('request-1', {
      status: 'succeeded',
      result: {
        kind: 'teardown',
        data: { workspace: workspaceRef(), path: '/repo/workspace' },
      },
      finishedAt: 40,
    });

    now = 1_000;
    await expect(store.pruneTerminal(100)).resolves.toMatchObject({
      success: true,
      data: [{ requestId: 'request-1', seq: 1 }],
    });
    await expect(store.list()).resolves.toEqual({ success: true, data: [] });

    const second = await store.appendRecord(recordDraft('request-2'));
    expect(second.success ? second.data.seq : null).toBe(2);
  });

  it('returns decode errors for malformed state documents', async () => {
    const store = createKvWorkspaceOperationRecordStore(
      createMemoryKeyValueStore({
        'workspace-operation-records': { nextSeq: 0, records: [] },
      })
    );

    await expect(store.list()).resolves.toMatchObject({
      success: false,
      error: { type: 'decode', key: 'workspace-operation-records' },
    });
  });
});

describe('createMemoryWorkspaceOperationRecordStore', () => {
  it('keeps memory store state isolated per instance', async () => {
    const first = createMemoryWorkspaceOperationRecordStore({ now: () => 1 });
    const second = createMemoryWorkspaceOperationRecordStore({ now: () => 1 });

    await first.appendRecord(recordDraft('request-1'));

    expect(first.snapshot().nextSeq).toBe(2);
    expect(second.snapshot().nextSeq).toBe(1);
    await expect(second.list()).resolves.toEqual({ success: true, data: [] });
  });
});

function recordDraft(requestId: string) {
  const workspace = workspaceRef();
  return {
    requestId,
    kind: 'teardown' as const,
    workspace,
    params: {
      kind: 'teardown' as const,
      input: { workspace, force: false },
    },
  };
}

function workspaceRef() {
  const parsed = parseAbsolute('/repo/workspace');
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
