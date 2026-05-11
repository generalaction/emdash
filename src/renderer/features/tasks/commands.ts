import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  asProvisioned,
  getRegisteredTaskData,
  getTaskGitStore,
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

      const mountedProject = asMounted(getProjectStore(projectId));
      const connectionId =
        mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

      const taskMgr = getTaskManagerStore(projectId);
      const taskIds = taskMgr ? Array.from(taskMgr.tasks.keys()) : [];
      const currentIdx = taskIds.indexOf(taskId);

      const git = getTaskGitStore(projectId, taskId);
      const taskData = getRegisteredTaskData(projectId, taskId);

      return [
        // ── Conversations ──────────────────────────────────────────────────
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

        // ── View sidebar panels ────────────────────────────────────────────
        {
          id: 'task.sidebarChanges',
          label: 'View Changes',
          description: 'Open the Changes panel in the right sidebar',
          shortcutKey: 'sidebarChanges',
          group: 'View',
          execute() {
            taskView?.setSidebarTab('changes');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: 'task.sidebarConversations',
          label: 'View Conversations',
          description: 'Open the Conversations panel in the right sidebar',
          shortcutKey: 'sidebarConversations',
          group: 'View',
          execute() {
            taskView?.setSidebarTab('conversations');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: 'task.sidebarFiles',
          label: 'View Files',
          description: 'Open the Files panel in the right sidebar',
          shortcutKey: 'sidebarFiles',
          group: 'View',
          execute() {
            taskView?.setSidebarTab('files');
            taskView?.setSidebarCollapsed(false);
          },
        },
        {
          id: 'task.viewTerminals',
          label: 'View Terminals',
          description: 'Open the terminal drawer',
          group: 'View',
          execute() {
            taskView?.setTerminalDrawerOpen(true);
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

        // ── Terminals ─────────────────────────────────────────────────────
        {
          id: 'task.newTerminal',
          label: 'New Terminal',
          description: 'Create a new terminal session',
          shortcutKey: 'newTerminal',
          group: 'Terminals',
          execute() {
            taskView?.openNewTerminal();
          },
        },

        // ── Git ────────────────────────────────────────────────────────────
        {
          id: 'task.gitFetch',
          label: 'Git Fetch',
          description: 'Fetch latest changes from remote',
          group: 'Git',
          enabled: git != null,
          execute() {
            void git?.fetchRemote();
          },
        },
        {
          id: 'task.gitPull',
          label: 'Git Pull',
          description: 'Pull latest changes from remote',
          group: 'Git',
          enabled: git != null,
          execute() {
            void git?.pull();
          },
        },
        {
          id: 'task.gitPush',
          label: git?.isBranchPublished ? 'Git Push' : 'Git Publish Branch',
          description: git?.isBranchPublished
            ? 'Push commits to remote'
            : 'Publish this branch to remote',
          group: 'Git',
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
          id: 'task.pin',
          label: taskData?.isPinned ? 'Unpin Task' : 'Pin Task',
          description: taskData?.isPinned
            ? 'Remove this task from pinned'
            : 'Pin this task to keep it at the top',
          group: 'Task',
          enabled: taskData != null,
          execute() {
            if (taskData) void taskStore?.setPinned(!taskData.isPinned);
          },
        },

        // ── Navigation ─────────────────────────────────────────────────────
        {
          id: 'task.nextTask',
          label: 'Next Task',
          description: 'Switch to the next task',
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
