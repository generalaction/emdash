import { assertIncrementalMigrationEquivalence } from '@primitives/sqlite-store/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { describeOperationStoreContract, newRecord } from '../testing/store-contract';
import { migrations } from './migrations/migrations.generated';
import { SqliteOperationStore } from './sqlite-operation-store';
import { operationStoreSqlite } from './store';

const stores: SqliteOperationStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe('SqliteOperationStore', () => {
  describeOperationStoreContract(makeStore);

  test('emits journal callbacks after commit', async () => {
    const transitions: string[] = [];
    const store = makeStore({
      onJournalAppend: (transition) => transitions.push(transition.cause),
    });

    await store.transaction((tx) => tx.insert(newRecord('a')));
    expect(transitions).toEqual(['submit']);

    await expect(
      store.transaction((tx) => {
        tx.insert(newRecord('b'));
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(transitions).toEqual(['submit']);
  });

  test('upgrades persisted v1 outcomes when records are read', async () => {
    const store = makeStore();
    await store.transaction((tx) => {
      const record = tx.insert(newRecord('legacy-outcome'));
      tx.transition(record.id, 'pending', 'failed', 'settle', {
        outcome: {
          version: '1',
          completedStages: ['inspect'],
          failedStage: 'teardown',
        } as never,
      });
    });

    await expect(store.get('legacy-outcome')).resolves.toMatchObject({
      outcome: {
        version: '2',
        stages: [
          { id: 'inspect', label: 'inspect', status: 'succeeded' },
          { id: 'teardown', label: 'teardown', status: 'failed' },
        ],
      },
    });
  });

  test('migrations are incrementally equivalent', async () => {
    await expect(
      assertIncrementalMigrationEquivalence(operationStoreSqlite, migrations.length)
    ).resolves.toBe(undefined);
  });
});

function makeStore(options: ConstructorParameters<typeof SqliteOperationStore>[1] = {}) {
  const handle = operationStoreSqlite.openAtMigration(migrations.length);
  const store = new SqliteOperationStore(handle, { now: () => 1, ...options });
  stores.push(store);
  return store;
}
