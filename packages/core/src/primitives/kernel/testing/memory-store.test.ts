import { MemoryOperationStore } from './memory-store';
import { describeOperationStoreContract } from './store-contract';

describeOperationStoreContract(() => new MemoryOperationStore({ now: () => 1 }));
