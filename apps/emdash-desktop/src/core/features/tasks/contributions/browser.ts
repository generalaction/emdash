import { AddRemoteModal } from '../browser/add-remote-modal';
import { CreateTaskModal } from '../browser/create-task-modal/create-task-modal';
import { DeleteTaskModal } from '../browser/delete-task-modal';
import { CreatePrModal } from '../browser/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { ConflictDialog } from '../browser/editor/conflict-dialog';
import { RenameTaskModal } from '../browser/rename-task-modal';
import { taskView } from '../browser/view';

export const tasksBrowserContributions = {
  views: {
    task: taskView,
  },
  modals: {
    taskModal: {
      component: CreateTaskModal,
      ignoreOutsidePressAfterWindowBlur: true,
    },
    conflictDialog: {
      component: ConflictDialog,
      size: 'sm',
    },
    createPrModal: {
      component: CreatePrModal,
      size: 'md',
    },
    renameTaskModal: {
      component: RenameTaskModal,
      size: 'xs',
    },
    addRemoteModal: {
      component: AddRemoteModal,
    },
    deleteTaskModal: {
      component: DeleteTaskModal,
      size: 'sm',
    },
  },
} as const;
