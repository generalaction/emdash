import type { TaskScopedStoreContext } from '@core/features/tasks/browser/contributions/task-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { terminalRegistry } from '../stores/terminal-registry';
import type { TerminalManagerStore } from '../task-terminal/terminal-manager';

export const terminalManagerStoreToken =
  scopedStoreToken<TerminalManagerStore>('terminals.manager');

export const terminalTaskStoreContributions: readonly ScopedStoreContribution<TaskScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: terminalManagerStoreToken,
      create: ({ projectId, taskId }) => terminalRegistry.acquire(taskId, projectId),
      dispose: (_, { taskId }) => terminalRegistry.release(taskId),
    }),
  ];
