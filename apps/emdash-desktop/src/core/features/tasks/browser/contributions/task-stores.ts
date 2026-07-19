import type { ScopedStoreLookup } from '@core/primitives/scoped-stores/browser';
import type { TaskStore } from '../stores/task-store';

export type TaskScopedStoreContext = Readonly<{
  projectId: string;
  taskId: string;
  task: TaskStore;
  projectStores: ScopedStoreLookup;
}>;
