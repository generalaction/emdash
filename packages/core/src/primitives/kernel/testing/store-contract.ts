import { describe, expect, test } from 'vitest';
import type { NewOperationRecord, OperationRecord } from '../api/record';
import type { OperationStore } from '../api/store';

export function describeOperationStoreContract(makeStore: () => OperationStore): void {
  describe('OperationStore contract', () => {
    test('assigns monotonic seq values', async () => {
      const store = makeStore();
      const inserted = await store.transaction((tx) => [
        tx.insert(newRecord('a')),
        tx.insert(newRecord('b')),
      ]);

      expect(inserted.map((record) => record.seq)).toEqual([1, 2]);
    });

    test('rejects failed compare-and-swap without adding transition rows', async () => {
      const store = makeStore();
      const inserted = await store.transaction((tx) => tx.insert(newRecord('a')));

      const transitioned = await store.transaction((tx) =>
        tx.transition(inserted.id, 'running', 'succeeded', 'settle')
      );

      expect(transitioned).toBe(false);
      expect(await store.listTransitions(inserted.id)).toMatchObject([{ cause: 'submit' }]);
      expect((await store.get(inserted.id))?.status).toBe('pending');
    });

    test('journals successful transitions with their cause', async () => {
      const store = makeStore();
      const inserted = await store.transaction((tx) => tx.insert(newRecord('a')));

      await store.transaction((tx) =>
        tx.transition(inserted.id, 'pending', 'running', 'dispatch', { updatedAt: 2 })
      );

      expect(await store.listTransitions(inserted.id)).toMatchObject([
        { operationId: inserted.id, from: 'pending', to: 'pending', cause: 'submit' },
        { operationId: inserted.id, from: 'pending', to: 'running', cause: 'dispatch' },
      ]);
      expect((await store.get(inserted.id))?.status).toBe('running');
    });

    test('rolls back records and journal rows when a transaction throws', async () => {
      const store = makeStore();

      await expect(
        store.transaction((tx) => {
          tx.insert(newRecord('a'));
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');

      expect(await store.listRecords()).toEqual([]);
    });

    test('rejects nested transactions', async () => {
      const store = makeStore();

      await expect(
        store.transaction(async () => {
          await store.transaction((tx) => tx.insert(newRecord('nested')));
        })
      ).rejects.toThrow(/Nested OperationStore transactions/);

      expect(await store.listRecords()).toEqual([]);
    });

    test('lists non-terminal claims on targeted keys', async () => {
      const store = makeStore();
      await store.transaction((tx) => {
        tx.insert(newRecord('a', 'worktree:a'));
        const terminal = tx.insert(newRecord('b', 'worktree:a'));
        tx.transition(terminal.id, 'pending', 'cancelled', 'cancel');
      });

      const rows = await store.transaction((tx) => tx.listNonTerminalClaimsOnKeys(['worktree:a']));

      expect(rows.map((row) => row.holder.id)).toEqual(['a']);
      expect(rows[0]?.key).toBe('worktree:a');
    });

    test('lists non-terminal records consistently inside a transaction', async () => {
      const store = makeStore();
      const ids = await store.transaction((tx) => {
        tx.insert(newRecord('a'));
        const second = tx.insert(newRecord('b'));
        tx.transition(second.id, 'pending', 'cancelled', 'cancel');
        return tx.listNonTerminal().map((record) => record.id);
      });

      expect(ids).toEqual(['a']);
    });

    test('journals adoption rows and updates adopted records', async () => {
      const store = makeStore();
      const inserted = await store.transaction((tx) => {
        const record = tx.insert(newRecord('a'));
        tx.reparent(record.id, 'parent');
        return tx.get(record.id);
      });

      expect(inserted?.parentId).toBe('parent');
      expect(await store.listTransitions('a')).toMatchObject([
        { operationId: 'a', from: 'pending', to: 'pending', cause: 'submit' },
        { operationId: 'a', from: 'pending', to: 'pending', cause: 'adoption' },
      ]);
    });
  });
}

export function newRecord(id: string, claimKey = `resource:${id}`): NewOperationRecord {
  return {
    id,
    name: 'test-operation',
    key: `test:${id}`,
    input: { version: '1', id },
    claims: [{ resource: 'resource', key: claimKey, mode: 'exclusive', implicit: false }],
    status: 'pending',
    attempt: 0,
    initiator: { kind: 'user', action: 'test' },
    createdAt: 1,
    updatedAt: 1,
  };
}

export function expectRecord(record: OperationRecord | undefined): OperationRecord {
  expect(record).toBeDefined();
  if (!record) {
    throw new Error('Expected operation record to be defined');
  }
  return record;
}
