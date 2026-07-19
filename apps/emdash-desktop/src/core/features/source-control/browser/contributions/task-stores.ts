import type { TaskScopedStoreContext } from '@core/features/tasks/browser/contributions/task-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { DraftCommentsStore } from '../diff-view/stores/draft-comments-store';

export const draftCommentsStoreToken = scopedStoreToken<DraftCommentsStore>(
  'source-control.draft-comments'
);

export const sourceControlTaskStoreContributions: readonly ScopedStoreContribution<TaskScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: draftCommentsStoreToken,
      create: ({ taskId }) => new DraftCommentsStore(taskId),
      dispose: (store) => store.dispose(),
    }),
  ];
