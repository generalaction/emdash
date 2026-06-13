import { browserControlsRegistry } from '@renderer/features/browser/browser-controls-registry';
import {
  getRegisteredTaskData,
  getTaskGitWorktreeStore,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { closeActiveTabWithConfirm } from '@renderer/features/tasks/tabs/close-tab-with-confirm';
import type { CommandProvider } from '@renderer/lib/commands/types';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { normalizeBrowserUrl } from '@shared/browser';
import { TASK_COMMAND_DEFS, type CommandDef, type TaskCommandId } from '@shared/commands';

function taskDef(id: TaskCommandId): CommandDef {
  return TASK_COMMAND_DEFS.find((d) => d.id === id)!;
}

/**
 * Returns a CommandProvider for the task scope.
 *
 * getCommands() reads MobX observables so the command registry's
 * @computed activeCommands reacts to state changes automatically.
 */
export function createTaskCommandProvider(projectId: string, taskId: string): CommandProvider {
  return {
    scopeId: 'task',

    getCommands() {
      const taskStore = getTaskStore(projectId, taskId);

      // Guard: only expose commands when the task is fully provisioned.
      if (taskStore?.state !== 'provisioned') return [];

      const taskView = getTaskView(projectId, taskId);
      const tabManager = taskView?.tabManager;
      const hasTabs = (tabManager?.resolvedTabs.length ?? 0) > 0;

      const taskIds = sidebarStore.visibleTaskIdsForProject(projectId);
      const currentIdx = taskIds.indexOf(taskId);

      const git = getTaskGitWorktreeStore(projectId, taskId);
      const taskData = getRegisteredTaskData(projectId, taskId);
      const activeBrowserTab = tabManager?.resolvedTabs.find(
        (tab) => tab.isActive && tab.kind === 'browser'
      );
      const activeBrowserSession =
        activeBrowserTab?.kind === 'browser' ? activeBrowserTab.session : null;

      const newConversationDef = taskDef('task.newConversation');
      const newConversationSplitRightDef = taskDef('task.newConversationSplitRight');
      const sidebarChangesDef = taskDef('task.sidebarChanges');
      const sidebarConversationsDef = taskDef('task.sidebarConversations');
      const sidebarFilesDef = taskDef('task.sidebarFiles');
      const viewTerminalsDef = taskDef('task.viewTerminals');
      const toggleTerminalDrawerDef = taskDef('task.toggleTerminalDrawer');
      const toggleRightSidebarDef = taskDef('task.toggleRightSidebar');
      const newTerminalDef = taskDef('task.newTerminal');
      const openBrowserDef = taskDef('task.openBrowser');
      const browserGoBackDef = taskDef('task.browserGoBack');
      const browserGoForwardDef = taskDef('task.browserGoForward');
      const browserReloadDef = taskDef('task.browserReload');
      const browserFocusUrlDef = taskDef('task.browserFocusUrl');
      const browserOpenExternalDef = taskDef('task.browserOpenExternal');
      const browserCopyUrlDef = taskDef('task.browserCopyUrl');
      const gitFetchDef = taskDef('task.gitFetch');
      const gitPullDef = taskDef('task.gitPull');
      const gitPushDef = taskDef('task.gitPush');
      const pinDef = taskDef('task.pin');
      const nextTaskDef = taskDef('task.nextTask');
      const prevTaskDef = taskDef('task.prevTask');

      return [
        // ── Conversations ──────────────────────────────────────────────────
        {
          id: newConversationDef.id,
          label: newConversationDef.label,
          description: newConversationDef.description,
          shortcutKey: newConversationDef.shortcutKey,
          group: newConversationDef.group,
          execute() {
            showModal('createConversationModal', {
              projectId,
              taskId,
              onSuccess: ({ conversationId }) => {
                taskView?.tabGroupManager.openConversation(conversationId);
                taskView?.setFocusedRegion('main');
              },
            });
          },
        },
        {
          id: newConversationSplitRightDef.id,
          label: newConversationSplitRightDef.label,
          description: newConversationSplitRightDef.description,
          shortcutKey: newConversationSplitRightDef.shortcutKey,
          group: newConversationSplitRightDef.group,
          execute() {
            showModal('createConversationModal', {
              projectId,
              taskId,
              onSuccess: ({ conversationId }) => {
                taskView?.tabGroupManager.openConversationInRightSplit(conversationId);
                taskView?.setFocusedRegion('main');
              },
            });
          },
        },

        // ── View sidebar panels ────────────────────────────────────────────
        {
          id: sidebarChangesDef.id,
          label: sidebarChangesDef.label,
          description: sidebarChangesDef.description,
          shortcutKey: sidebarChangesDef.shortcutKey,
          group: sidebarChangesDef.group,
          execute() {
            taskView?.setSidebarTab('changes');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: sidebarConversationsDef.id,
          label: sidebarConversationsDef.label,
          description: sidebarConversationsDef.description,
          shortcutKey: sidebarConversationsDef.shortcutKey,
          group: sidebarConversationsDef.group,
          execute() {
            taskView?.setSidebarTab('conversations');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: sidebarFilesDef.id,
          label: sidebarFilesDef.label,
          description: sidebarFilesDef.description,
          shortcutKey: sidebarFilesDef.shortcutKey,
          group: sidebarFilesDef.group,
          execute() {
            taskView?.setSidebarTab('files');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: viewTerminalsDef.id,
          label: viewTerminalsDef.label,
          description: viewTerminalsDef.description,
          group: viewTerminalsDef.group,
          execute() {
            taskView?.setTerminalDrawerOpen(true);
          },
        },

        // ── Layout toggles ─────────────────────────────────────────────────
        {
          id: toggleTerminalDrawerDef.id,
          label: toggleTerminalDrawerDef.label,
          description: toggleTerminalDrawerDef.description,
          shortcutKey: toggleTerminalDrawerDef.shortcutKey,
          group: toggleTerminalDrawerDef.group,
          execute() {
            taskView?.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen);
          },
        },
        {
          id: toggleRightSidebarDef.id,
          // Dynamic label reflecting current collapsed/expanded state
          label: taskView?.isSidebarCollapsed ? 'Show Right Sidebar' : 'Hide Right Sidebar',
          description: toggleRightSidebarDef.description,
          shortcutKey: toggleRightSidebarDef.shortcutKey,
          group: toggleRightSidebarDef.group,
          execute() {
            taskView?.setSidebarCollapsed(!taskView.isSidebarCollapsed);
          },
        },

        // ── Terminals ─────────────────────────────────────────────────────
        {
          id: newTerminalDef.id,
          label: newTerminalDef.label,
          description: newTerminalDef.description,
          shortcutKey: newTerminalDef.shortcutKey,
          group: newTerminalDef.group,
          execute() {
            void taskView?.openNewTerminal();
          },
        },
        {
          id: openBrowserDef.id,
          label: openBrowserDef.label,
          description: openBrowserDef.description,
          shortcutKey: openBrowserDef.shortcutKey,
          group: openBrowserDef.group,
          execute() {
            taskView?.tabGroupManager.openBrowser();
            taskView?.setFocusedRegion('main');
          },
        },
        {
          id: browserGoBackDef.id,
          label: browserGoBackDef.label,
          description: browserGoBackDef.description,
          group: browserGoBackDef.group,
          enabled: activeBrowserTab?.kind === 'browser' && activeBrowserTab.session.canGoBack,
          execute() {
            if (activeBrowserTab?.kind !== 'browser') return;
            const adapter = browserControlsRegistry.get(activeBrowserTab.browserId)?.adapter;
            if (adapter?.canGoBack()) adapter.goBack();
          },
        },
        {
          id: browserGoForwardDef.id,
          label: browserGoForwardDef.label,
          description: browserGoForwardDef.description,
          group: browserGoForwardDef.group,
          enabled: activeBrowserTab?.kind === 'browser' && activeBrowserTab.session.canGoForward,
          execute() {
            if (activeBrowserTab?.kind !== 'browser') return;
            const adapter = browserControlsRegistry.get(activeBrowserTab.browserId)?.adapter;
            if (adapter?.canGoForward()) adapter.goForward();
          },
        },
        {
          id: browserReloadDef.id,
          label: browserReloadDef.label,
          description: browserReloadDef.description,
          group: browserReloadDef.group,
          enabled: activeBrowserTab != null,
          execute() {
            if (activeBrowserTab?.kind !== 'browser') return;
            browserControlsRegistry.get(activeBrowserTab.browserId)?.adapter?.reload();
          },
        },
        {
          id: browserFocusUrlDef.id,
          label: browserFocusUrlDef.label,
          description: browserFocusUrlDef.description,
          group: browserFocusUrlDef.group,
          enabled: activeBrowserTab != null,
          execute() {
            if (activeBrowserTab?.kind !== 'browser') return;
            browserControlsRegistry.get(activeBrowserTab.browserId)?.focusUrl();
          },
        },
        {
          id: browserOpenExternalDef.id,
          label: browserOpenExternalDef.label,
          description: browserOpenExternalDef.description,
          group: browserOpenExternalDef.group,
          enabled: activeBrowserTab != null,
          execute() {
            if (activeBrowserTab?.kind !== 'browser') return;
            const normalized = normalizeBrowserUrl(activeBrowserTab.session.currentUrl);
            if (
              normalized.ok &&
              (normalized.protocol === 'http:' || normalized.protocol === 'https:')
            ) {
              void rpc.app.openExternal(normalized.url);
            }
          },
        },
        ...(activeBrowserSession
          ? [
              {
                id: browserCopyUrlDef.id,
                label: browserCopyUrlDef.label,
                description: browserCopyUrlDef.description,
                shortcutKey: browserCopyUrlDef.shortcutKey,
                group: browserCopyUrlDef.group,
                execute() {
                  const normalized = normalizeBrowserUrl(activeBrowserSession.currentUrl, {
                    allowSearchQueries: false,
                  });
                  if (!normalized.ok) return;
                  void navigator.clipboard
                    .writeText(normalized.url)
                    .then(() => {
                      toast({ title: 'Browser URL copied' });
                    })
                    .catch(() => {
                      toast({ title: 'Could not copy browser URL', variant: 'destructive' });
                    });
                },
              },
            ]
          : []),

        // ── Tab management ─────────────────────────────────────────────────
        {
          id: 'task.tabClose',
          label: 'Close Tab',
          description: 'Close the active tab',
          shortcutKey: 'tabClose',
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            if (tabManager) closeActiveTabWithConfirm(tabManager);
          },
        },
        {
          id: 'task.tabNext',
          label: 'Next Tab',
          description: 'Switch to the next tab',
          shortcutKey: 'tabNext',
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            tabManager?.setNextTabActive();
          },
        },
        {
          id: 'task.tabPrev',
          label: 'Previous Tab',
          description: 'Switch to the previous tab',
          shortcutKey: 'tabPrev',
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            tabManager?.setPreviousTabActive();
          },
        },
        ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
          id: `task.tab${n}`,
          label: `Go to Tab ${n}`,
          description: `Switch to tab ${n}`,
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            tabManager?.setTabActiveIndex(n - 1);
          },
        })),

        // ── Git ────────────────────────────────────────────────────────────
        {
          id: gitFetchDef.id,
          label: gitFetchDef.label,
          description: gitFetchDef.description,
          group: gitFetchDef.group,
          enabled: git != null,
          execute() {
            void git?.fetchRemote();
          },
        },
        {
          id: gitPullDef.id,
          label: gitPullDef.label,
          description: gitPullDef.description,
          group: gitPullDef.group,
          enabled: git != null,
          execute() {
            void git?.pull();
          },
        },
        {
          id: gitPushDef.id,
          // Dynamic label: push vs publish branch
          label: git?.isBranchPublished ? 'Git Push' : 'Git Publish Branch',
          description: git?.isBranchPublished
            ? 'Push commits to remote'
            : 'Publish this branch to remote',
          group: gitPushDef.group,
          enabled: git != null,
          execute() {
            if (git?.isBranchPublished) {
              void git.push();
            } else {
              void git?.publishBranch();
            }
          },
        },

        // ── Task actions ───────────────────────────────────────────────────
        {
          id: pinDef.id,
          // Dynamic label: pin vs unpin
          label: taskData?.isPinned ? 'Unpin Task' : 'Pin Task',
          description: taskData?.isPinned
            ? 'Remove this task from pinned'
            : 'Pin this task to keep it at the top',
          group: pinDef.group,
          enabled: taskData != null,
          execute() {
            if (taskData) void taskStore?.setPinned(!taskData.isPinned);
          },
        },
        // ── Navigation ─────────────────────────────────────────────────────
        {
          id: nextTaskDef.id,
          label: nextTaskDef.label,
          description: nextTaskDef.description,
          group: nextTaskDef.group,
          enabled: currentIdx !== -1 && currentIdx < taskIds.length - 1,
          hideFromPalette: true,
          execute() {
            const nextId = taskIds[currentIdx + 1];
            if (nextId) appState.navigation.navigate('task', { projectId, taskId: nextId });
          },
        },
        {
          id: prevTaskDef.id,
          label: prevTaskDef.label,
          description: prevTaskDef.description,
          group: prevTaskDef.group,
          enabled: currentIdx > 0,
          hideFromPalette: true,
          execute() {
            const prevId = taskIds[currentIdx - 1];
            if (prevId) appState.navigation.navigate('task', { projectId, taskId: prevId });
          },
        },
      ];
    },
  };
}
