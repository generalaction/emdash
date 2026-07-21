import { useLayoutEffect, type ReactNode } from 'react';
import { browserControlsRegistry } from '@core/features/browser/browser/browser-controls-registry';
import type { BrowserTabResource } from '@core/features/browser/browser/browser-tab-resource';
import {
  runGitFetch,
  runGitPublishBranch,
  runGitPull,
  runGitPush,
} from '@core/features/source-control/browser/git-action-handlers';
import { getGitRepositoryStore } from '@core/features/source-control/browser/stores/source-control-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/browser/stores/task-source-control-selectors';
import {
  getRegisteredTaskData,
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/browser/stores/task-selectors';
import { taskViewScope } from '@core/features/tasks/contributions/scopes';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { ResolvedTab } from '@core/features/workbench/browser/tabs/core/tab-provider';
import { getTaskComposition } from '@core/features/workbench/browser/task-composition-selectors';
import { normalizeBrowserUrl } from '@core/primitives/browser/api';
import {
  disabled,
  enabled,
  hidden,
  type CommandAvailability,
  type ViewScopeImpl,
} from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { openModal } from '@renderer/lib/modal/api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';

type TaskScopeParams = { readonly projectId: string; readonly taskId: string };

function taskAvailability(
  params: TaskScopeParams,
  predicate: () => boolean = () => true,
  reason = 'Command is unavailable'
): CommandAvailability {
  if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
  return predicate() ? enabled : disabled(reason);
}

function activeBrowser(params: TaskScopeParams) {
  const taskView = getTaskComposition(params.projectId, params.taskId);
  const tab = taskView?.activePane?.resolvedTabs.find(
    (candidate) => candidate.isActive && candidate.kind === 'browser'
  ) as ResolvedTab<BrowserTabResource> | undefined;
  const resource = tab?.resource as BrowserTabResource | undefined;
  return {
    resource,
    session: resource?.session ?? null,
  };
}

async function createConversation(params: TaskScopeParams, target?: 'right'): Promise<void> {
  const outcome = await openModal('createConversationModal', params);
  if (!outcome.success) return;
  const taskView = getTaskComposition(params.projectId, params.taskId);
  const { conversationId, type } = outcome.data;
  taskView?.paneLayout.open(
    type === 'acp' ? 'acp-chat' : 'conversation',
    { conversationId },
    target ? { preview: false, target } : { preview: false }
  );
  taskView?.setFocusedRegion('main');
}

const taskScopeImplementation = {
  'task.newConversation': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void createConversation(params);
    },
  }),
  'task.newConversationSplitRight': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void createConversation(params, 'right');
    },
  }),
  'task.sidebarChanges': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      taskView?.setSidebarTab('changes');
      taskView?.setSidebarCollapsed(false);
    },
  }),
  'task.sidebarConversations': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      taskView?.setSidebarTab('conversations');
      taskView?.setSidebarCollapsed(false);
    },
  }),
  'task.sidebarFiles': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      taskView?.setSidebarTab('files');
      taskView?.setSidebarCollapsed(false);
    },
  }),
  'task.fileContentSearch': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (!taskView) return;
      taskView.setSidebarTab('files');
      taskView.setSidebarCollapsed(false);
      taskView.editorView.requestFileSearchFocus();
    },
  }),
  'task.viewTerminals': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => getTaskComposition(params.projectId, params.taskId)?.setTerminalDrawerOpen(true),
  }),
  'task.toggleTerminalDrawer': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (!taskView) return;
      if (taskView.isTerminalDrawerOpen) {
        taskView.setTerminalDrawerOpen(false);
      } else if (taskView.terminalTabs.tabs.length === 0) {
        void taskView.openNewTerminal();
      } else {
        taskView.setTerminalDrawerOpen(true);
      }
    },
  }),
  'task.toggleRightSidebar': (params) => ({
    availability: () => taskAvailability(params),
    presentation: () => {
      const collapsed = getTaskComposition(params.projectId, params.taskId)?.isSidebarCollapsed;
      return {
        title: collapsed ? 'Show Right Sidebar' : 'Hide Right Sidebar',
      };
    },
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (taskView) taskView.setSidebarCollapsed(!taskView.isSidebarCollapsed);
    },
  }),
  'task.newTerminal': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void getTaskComposition(params.projectId, params.taskId)?.openNewTerminal();
    },
  }),
  'task.openBrowser': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      taskView?.paneLayout.open('browser', {});
      taskView?.setFocusedRegion('main');
    },
  }),
  'task.browserGoBack': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(activeBrowser(params).session?.canGoBack),
        'Browser cannot go back'
      ),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (!resource) return;
      const adapter = browserControlsRegistry.get(resource.browserId)?.adapter;
      if (adapter?.canGoBack()) adapter.goBack();
    },
  }),
  'task.browserGoForward': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(activeBrowser(params).session?.canGoForward),
        'Browser cannot go forward'
      ),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (!resource) return;
      const adapter = browserControlsRegistry.get(resource.browserId)?.adapter;
      if (adapter?.canGoForward()) adapter.goForward();
    },
  }),
  'task.browserReload': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).resource), 'No active browser'),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (resource) browserControlsRegistry.get(resource.browserId)?.adapter?.reload();
    },
  }),
  'task.browserFocusUrl': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).resource), 'No active browser'),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (resource) browserControlsRegistry.get(resource.browserId)?.focusUrl();
    },
  }),
  'task.browserOpenExternal': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).session), 'No active browser'),
    execute: () => {
      const { session } = activeBrowser(params);
      if (!session) return;
      const normalized = normalizeBrowserUrl(session.currentUrl);
      if (normalized.ok && (normalized.protocol === 'http:' || normalized.protocol === 'https:')) {
        void rpc.app.openExternal(normalized.url);
      }
    },
  }),
  'task.browserCopyUrl': (params) => ({
    availability: () => {
      if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
      return activeBrowser(params).session ? enabled : hidden;
    },
    execute: () => {
      const { session } = activeBrowser(params);
      if (!session) return;
      const normalized = normalizeBrowserUrl(session.currentUrl, { allowSearchQueries: false });
      if (!normalized.ok) return;
      void navigator.clipboard
        .writeText(normalized.url)
        .then(() => toast({ title: 'Browser URL copied' }))
        .catch(() => toast({ title: 'Could not copy browser URL', variant: 'destructive' }));
    },
  }),
  'task.gitFetch': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getGitRepositoryStore(params.projectId)),
        'No Git repository'
      ),
    execute: () => {
      const repository = getGitRepositoryStore(params.projectId);
      if (repository) void runGitFetch(repository);
    },
  }),
  'task.gitPull': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getTaskGitCheckoutStore(params.projectId, params.taskId)),
        'No Git checkout'
      ),
    execute: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      if (git) void runGitPull(git);
    },
  }),
  'task.gitPush': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getTaskGitCheckoutStore(params.projectId, params.taskId)),
        'No Git checkout'
      ),
    presentation: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      return git?.isBranchPublished
        ? { title: 'Git Push', description: 'Push commits to remote' }
        : { title: 'Git Publish Branch', description: 'Publish this branch to remote' };
    },
    execute: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      if (!git) return;
      if (git.isBranchPublished) {
        void runGitPush(git);
        return;
      }
      const repository = getGitRepositoryStore(params.projectId);
      if (!repository) return;
      void runGitPublishBranch({
        repository,
        branchName: git.branchName,
        workspaceId: getTaskStore(params.projectId, params.taskId)?.workspaceId ?? undefined,
      });
    },
  }),
  'task.pin': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getRegisteredTaskData(params.projectId, params.taskId)),
        'Task data is unavailable'
      ),
    presentation: () => {
      const task = getRegisteredTaskData(params.projectId, params.taskId);
      return task?.isPinned
        ? { title: 'Unpin Task', description: 'Remove this task from pinned' }
        : { title: 'Pin Task', description: 'Pin this task to keep it at the top' };
    },
    execute: () => {
      const task = getRegisteredTaskData(params.projectId, params.taskId);
      const taskStore = getTaskStore(params.projectId, params.taskId);
      if (task && taskStore) void taskStore.setPinned(!task.isPinned);
    },
  }),
  'task.archive': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => {
          const task = getRegisteredTaskData(params.projectId, params.taskId);
          return Boolean(task && !task.archivedAt);
        },
        'Task is already archived'
      ),
    execute: () => {
      void getTaskManagerStore(params.projectId)
        ?.archiveTask(params.taskId)
        .catch(() => toast({ title: 'Could not archive task', variant: 'destructive' }));
    },
  }),
  'task.convertAutomation': (params) => ({
    availability: () => {
      if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
      return getRegisteredTaskData(params.projectId, params.taskId)?.type === 'automation-run'
        ? enabled
        : hidden;
    },
    execute: () => {
      void getTaskStore(params.projectId, params.taskId)?.convertAutomationTask();
    },
  }),
  'task.nextTask': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => {
          const entries = sidebarStore.visibleTaskEntries;
          const index = entries.findIndex(
            (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
          );
          return index !== -1 && index < entries.length - 1;
        },
        'No next task'
      ),
    execute: () => {
      const entries = sidebarStore.visibleTaskEntries;
      const index = entries.findIndex(
        (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
      );
      const next = entries[index + 1];
      if (next) appState.navigation.navigate(taskViewDef(next));
    },
  }),
  'task.prevTask': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => {
          const entries = sidebarStore.visibleTaskEntries;
          return (
            entries.findIndex(
              (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
            ) > 0
          );
        },
        'No previous task'
      ),
    execute: () => {
      const entries = sidebarStore.visibleTaskEntries;
      const index = entries.findIndex(
        (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
      );
      const previous = entries[index - 1];
      if (previous) appState.navigation.navigate(taskViewDef(previous));
    },
  }),
} satisfies ViewScopeImpl<typeof taskViewScope>;

export function TaskScope({
  projectId,
  taskId,
  children,
}: {
  readonly projectId: string;
  readonly taskId: string;
  readonly children: ReactNode;
}) {
  const { instance } = useViewScope<typeof taskViewScope>(
    taskViewScope({ projectId, taskId }),
    taskScopeImplementation
  );

  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  if (!instance) return null;
  return <ViewScopeInstanceProvider instance={instance}>{children}</ViewScopeInstanceProvider>;
}
