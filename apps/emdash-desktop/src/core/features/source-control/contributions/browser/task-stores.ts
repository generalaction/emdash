import { DraftCommentsStore } from '@core/features/source-control/api/browser/diff-view/stores/draft-comments-store';
import type { TaskScopedStoreContext } from '@core/features/tasks/contributions/browser/task-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

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
