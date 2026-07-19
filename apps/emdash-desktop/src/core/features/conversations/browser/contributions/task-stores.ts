import type { TaskScopedStoreContext } from '@core/features/tasks/browser/contributions/task-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import type { ConversationManagerStore } from '../conversation-manager';
import { conversationRegistry } from '../stores/conversation-registry';

export const conversationManagerStoreToken =
  scopedStoreToken<ConversationManagerStore>('conversations.manager');

export const conversationTaskStoreContributions: readonly ScopedStoreContribution<TaskScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: conversationManagerStoreToken,
      create: ({ projectId, taskId }) => conversationRegistry.acquire(taskId, projectId),
      dispose: (_, { taskId }) => conversationRegistry.release(taskId),
    }),
  ];
