import { scopedStoreToken } from '@core/primitives/scoped-stores/browser';
import type { TaskComposition } from '../task-composition';

export const taskCompositionStoreToken = scopedStoreToken<TaskComposition>(
  'workbench.task-composition'
);
