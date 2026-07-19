import { scopedStoreToken } from '@core/primitives/scoped-stores/browser';
import type { TaskManagerStore } from '../stores/task-manager';

export const taskManagerStoreToken = scopedStoreToken<TaskManagerStore>('tasks.manager');
