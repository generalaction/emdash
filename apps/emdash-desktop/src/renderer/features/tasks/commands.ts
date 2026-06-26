import { browserControlsRegistry } from '@renderer/features/browser/browser-controls-registry';
import type { BrowserTabResource } from '@renderer/features/browser/browser-tab-resource';
import { getGitRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import type { ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import {
  getRegisteredTaskData,
  getTaskGitWorktreeStore,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import type { CommandProvider } from '@renderer/lib/commands/types';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { normalizeBrowserUrl } from '@shared/browser';
import { TASK_COMMAND_DEFS, type CommandDef, type TaskCommandId } from '@shared/commands';
import { runGitFetch, runGitPublishBranch, runGitPull, runGitPush } from './git-action-handlers';

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
      const activePane = taskView?.activePane;
      const hasTabs = (activePane?.resolvedTabs.length ?? 0) > 0;

      const visibleTaskEntries = sidebarStore.visibleTaskEntries;
      const currentIdx = visibleTaskEntries.findIndex(
        (entry) => entry.projectId === projectId && entry.taskId === taskId
      );

      const git = getTaskGitWorktreeStore(projectId, taskId);
      const repository = git ? getGitRepositoryStore(projectId) : undefined;
      const taskData = getRegisteredTaskData(projectId, taskId);
      const activeBrowserTab = activePane?.resolvedTabs.find(
        (tab) => tab.isActive && tab.kind === 'browser'
      ) as ResolvedTab<BrowserTabResource> | undefined;
      const activeBrowserResource = activeBrowserTab?.resource as BrowserTabResource | undefined;
      const activeBrowserSession = activeBrowserResource?.session ?? null;

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
              onSuccess: ({ conversationId, type }) => {
                taskView?.paneLayout.open(
                  type === 'acp' ? 'acp-chat' : 'conversation',
                  { conversationId },
                  { preview: false }
                );
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
              onSuccess: ({ conversationId, type }) => {
                taskView?.paneLayout.open(
                  type === 'acp' ? 'acp-chat' : 'conversation',
                  { conversationId },
                  { preview: false, target: 'right' }
                );
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
            if (!taskView) return;
            if (taskView.isTerminalDrawerOpen) {
              taskView.setTerminalDrawerOpen(false);
              return;
            }
            if (taskView.terminalTabs.tabs.length === 0) {
              void taskView.openNewTerminal();
              return;
            }
            taskView.setTerminalDrawerOpen(true);
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
            taskView?.paneLayout.open('browser', {});
            taskView?.setFocusedRegion('main');
          },
        },
        {
          id: browserGoBackDef.id,
          label: browserGoBackDef.label,
          description: browserGoBackDef.description,
          group: browserGoBackDef.group,
          enabled: activeBrowserResource != null && (activeBrowserSession?.canGoBack ?? false),
          execute() {
            if (!activeBrowserResource) return;
            const adapter = browserControlsRegistry.get(activeBrowserResource.browserId)?.adapter;
            if (adapter?.canGoBack()) adapter.goBack();
          },
        },
        {
          id: browserGoForwardDef.id,
          label: browserGoForwardDef.label,
          description: browserGoForwardDef.description,
          group: browserGoForwardDef.group,
          enabled: activeBrowserResource != null && (activeBrowserSession?.canGoForward ?? false),
          execute() {
            if (!activeBrowserResource) return;
            const adapter = browserControlsRegistry.get(activeBrowserResource.browserId)?.adapter;
            if (adapter?.canGoForward()) adapter.goForward();
          },
        },
        {
          id: browserReloadDef.id,
          label: browserReloadDef.label,
          description: browserReloadDef.description,
          group: browserReloadDef.group,
          enabled: activeBrowserResource != null,
          execute() {
            if (!activeBrowserResource) return;
            browserControlsRegistry.get(activeBrowserResource.browserId)?.adapter?.reload();
          },
        },
        {
          id: browserFocusUrlDef.id,
          label: browserFocusUrlDef.label,
          description: browserFocusUrlDef.description,
          group: browserFocusUrlDef.group,
          enabled: activeBrowserResource != null,
          execute() {
            if (!activeBrowserResource) return;
            browserControlsRegistry.get(activeBrowserResource.browserId)?.focusUrl();
          },
        },
        {
          id: browserOpenExternalDef.id,
          label: browserOpenExternalDef.label,
          description: browserOpenExternalDef.description,
          group: browserOpenExternalDef.group,
          enabled: activeBrowserResource != null,
          execute() {
            if (!activeBrowserResource || !activeBrowserSession) return;
            const normalized = normalizeBrowserUrl(activeBrowserSession.currentUrl);
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
            const activeId = activePane?.activeTabId;
            if (activePane && activeId) activePane.requestCloseTab(activeId);
          },
        },
        {
          id: 'task.tabReopen',
          label: 'Reopen Closed Tab',
          description: 'Reopen the most recently closed tab',
          shortcutKey: 'tabReopen',
          group: 'Tabs',
          execute() {
            activePane?.reopenClosedTab();
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
            activePane?.setNextTabActive();
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
            activePane?.setPreviousTabActive();
          },
        },
        ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
          id: `task.tab${n}`,
          label: `Go to Tab ${n}`,
          description: `Switch to tab ${n}`,
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            activePane?.setTabActiveIndex(n - 1);
          },
        })),

        // ── Git ────────────────────────────────────────────────────────────
        {
          id: gitFetchDef.id,
          label: gitFetchDef.label,
          description: gitFetchDef.description,
          group: gitFetchDef.group,
          enabled: repository != null,
          execute() {
            if (repository) void runGitFetch(repository);
          },
        },
        {
          id: gitPullDef.id,
          label: gitPullDef.label,
          description: gitPullDef.description,
          group: gitPullDef.group,
          enabled: git != null,
          execute() {
            if (git) void runGitPull(git);
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
            if (!git) return;
            if (git.isBranchPublished) {
              void runGitPush(git);
            } else {
              if (!repository) return;
              void runGitPublishBranch({
                repository,
                branchName: git.branchName,
                workspaceId: taskStore.workspaceId ?? undefined,
              });
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
          shortcutKey: nextTaskDef.shortcutKey,
          group: nextTaskDef.group,
          enabled: currentIdx !== -1 && currentIdx < visibleTaskEntries.length - 1,
          hideFromPalette: true,
          execute() {
            const next = visibleTaskEntries[currentIdx + 1];
            if (next) appState.navigation.navigate('task', next);
          },
        },
        {
          id: prevTaskDef.id,
          label: prevTaskDef.label,
          description: prevTaskDef.description,
          shortcutKey: prevTaskDef.shortcutKey,
          group: prevTaskDef.group,
          enabled: currentIdx > 0,
          hideFromPalette: true,
          execute() {
            const previous = visibleTaskEntries[currentIdx - 1];
            if (previous) appState.navigation.navigate('task', previous);
          },
        },
      ];
    },
  };
}
