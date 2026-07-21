import type { TaskComposition } from '@core/features/workbench/api/browser/task-composition';
import { scopedStoreToken } from '@core/primitives/scoped-stores/browser';

export const taskCompositionStoreToken = scopedStoreToken<TaskComposition>(
  'workbench.task-composition'
);
