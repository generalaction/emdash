import type { OperationStore } from '../api/store';
import type { Clock } from './execution';

export async function recoverOperationStore(store: OperationStore, clock: Clock): Promise<void> {
  await store.transaction((tx) => {
    for (const record of tx.listNonTerminal()) {
      if (record.status === 'running') {
        tx.transition(record.id, 'running', 'pending', 'crash-reset', {
          updatedAt: clock.now(),
        });
      }
    }
  });
}
