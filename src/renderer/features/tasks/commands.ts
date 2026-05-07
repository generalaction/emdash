import { startTransition } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import type { CommandProvider } from '@renderer/lib/commands/types';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';

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
      const provisioned = asProvisioned(taskStore);

      // Guard: only expose commands when the task is fully provisioned.
      if (!provisioned) return [];

      const taskView = getTaskView(projectId, taskId);
      const tabManager = taskView?.tabManager;
      const hasTabs = (tabManager?.resolvedTabs.length ?? 0) > 0;

      const mountedProject = asMounted(getProjectStore(projectId));
      const connectionId =
        mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

      const taskMgr = getTaskManagerStore(projectId);
      const taskIds = taskMgr ? Array.from(taskMgr.tasks.keys()) : [];
      const currentIdx = taskIds.indexOf(taskId);

      return [
        {
          id: 'task.newConversation',
          label: 'New Conversation',
          description: 'Create a new conversation in the current task',
          shortcutKey: 'newConversation',
          group: 'Conversations',
          execute() {
            showModal('createConversationModal', {
              projectId,
              taskId,
              connectionId,
              onSuccess: ({ conversationId }) => {
                tabManager?.openConversation(conversationId);
                taskView?.setFocusedRegion('main');
              },
            });
          },
        },
        {
          id: 'task.switchToConversations',
          label: 'Switch to Conversations view',
          description: 'Show the conversations panel in the main area',
          shortcutKey: 'taskViewAgents',
          group: 'Panel',
          execute() {
            startTransition(() => taskView?.setView('agents'));
          },
        },
        {
          id: 'task.switchToDiff',
          label: 'Switch to Diff view',
          description: 'Show the diff panel in the main area',
          shortcutKey: 'taskViewDiff',
          group: 'Panel',
          execute() {
            startTransition(() => taskView?.setView('diff'));
          },
        },
        {
          id: 'task.switchToEditor',
          label: 'Switch to Editor view',
          description: 'Show the editor panel in the main area',
          shortcutKey: 'taskViewEditor',
          group: 'Panel',
          execute() {
            startTransition(() => taskView?.setView('editor'));
          },
        },

        // ── Sidebar tab switches ───────────────────────────────────────────
        {
          id: 'task.sidebarChanges',
          label: 'Sidebar: Changes',
          description: 'Switch the right sidebar to the Changes panel',
          shortcutKey: 'sidebarChanges',
          group: 'Panel',
          execute() {
            taskView?.setSidebarTab('changes');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: 'task.sidebarConversations',
          label: 'Sidebar: Conversations',
          description: 'Switch the right sidebar to the Conversations panel',
          shortcutKey: 'sidebarConversations',
          group: 'Panel',
          execute() {
            taskView?.setSidebarTab('conversations');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: 'task.sidebarFiles',
          label: 'Sidebar: Files',
          description: 'Switch the right sidebar to the Files panel',
          shortcutKey: 'sidebarFiles',
          group: 'Panel',
          execute() {
            taskView?.setSidebarTab('files');
            taskView?.setSidebarCollapsed(false);
          },
        },

        // ── Layout toggles ─────────────────────────────────────────────────
        {
          id: 'task.toggleTerminalDrawer',
          label: taskView?.isTerminalDrawerOpen ? 'Close Terminal Drawer' : 'Open Terminal Drawer',
          description: 'Show or hide the terminal drawer',
          shortcutKey: 'toggleTerminalDrawer',
          group: 'Panel',
          execute() {
            taskView?.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen);
          },
        },
        {
          id: 'task.toggleRightSidebar',
          label: taskView?.isSidebarCollapsed ? 'Show Right Sidebar' : 'Hide Right Sidebar',
          description: 'Show or hide the right sidebar',
          shortcutKey: 'toggleRightSidebar',
          group: 'Panel',
          execute() {
            taskView?.setSidebarCollapsed(!taskView.isSidebarCollapsed);
          },
        },

        // ── Tab management ─────────────────────────────────────────────────
        {
          id: 'task.tabClose',
          label: 'Close Tab',
          description: 'Close the active tab',
          shortcutKey: 'tabClose',
          group: 'Tabs',
          enabled: hasTabs,
          execute() {
            tabManager?.closeActiveTab();
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
        {
          id: 'task.nextTask',
          label: 'Next Task',
          description: 'Switch to the next task',
          shortcutKey: 'nextProject',
          group: 'Navigation',
          enabled: currentIdx !== -1 && currentIdx < taskIds.length - 1,
          execute() {
            const nextId = taskIds[currentIdx + 1];
            if (nextId) appState.navigation.navigate('task', { projectId, taskId: nextId });
          },
        },
        {
          id: 'task.prevTask',
          label: 'Previous Task',
          description: 'Switch to the previous task',
          shortcutKey: 'prevProject',
          group: 'Navigation',
          enabled: currentIdx > 0,
          execute() {
            const prevId = taskIds[currentIdx - 1];
            if (prevId) appState.navigation.navigate('task', { projectId, taskId: prevId });
          },
        },
      ];
    },
  };
}
