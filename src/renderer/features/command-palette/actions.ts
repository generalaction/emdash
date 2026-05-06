import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import type { useModalContext } from '@renderer/lib/modal/modal-provider';

type ShowModalFn = ReturnType<typeof useModalContext>['showModal'];

export interface CommandAction {
  kind: 'action';
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  projectId: null;
  score: number;
}

export interface CommandActionWithHandler extends CommandAction {
  execute: () => void;
}

export interface ActionContext {
  projectId?: string;
  taskId?: string;
  navigate: NavigateFnTyped;
  showModal: ShowModalFn;
  closeModal: () => void;
}

export function buildActions(ctx: ActionContext): CommandActionWithHandler[] {
  const { navigate, showModal, closeModal, projectId, taskId } = ctx;

  const actions: CommandActionWithHandler[] = [
    {
      kind: 'action',
      id: 'settings',
      title: 'Settings',
      subtitle: 'Open application settings',
      shortcut: '⌘,',
      projectId: null,
      score: 0,
      execute: () => {
        closeModal();
        navigate('settings');
      },
    },
    {
      kind: 'action',
      id: 'new-project',
      title: 'New Project',
      subtitle: 'Add a new local or SSH project',
      shortcut: '⌘⇧N',
      projectId: null,
      score: 0,
      execute: () => showModal('addProjectModal', { strategy: 'local', mode: 'pick' }),
    },
  ];

  if (projectId) {
    actions.push({
      kind: 'action',
      id: 'new-task',
      title: 'New Task',
      subtitle: 'Create a new task in this project',
      shortcut: '⌘N',
      projectId: null,
      score: 0,
      execute: () => showModal('taskModal', { projectId }),
    });
  }

  if (projectId && taskId) {
    actions.push({
      kind: 'action',
      id: 'new-conversation',
      title: 'New Conversation',
      subtitle: 'Start a new AI conversation in this task',
      shortcut: '⌘⇧C',
      projectId: null,
      score: 0,
      execute: () => {
        closeModal();
        showModal('createConversationModal', { projectId, taskId });
      },
    });
  }

  return actions;
}
