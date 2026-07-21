import type { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import type { TaskScopedStoreContext } from '@core/features/tasks/contributions/browser/task-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

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
