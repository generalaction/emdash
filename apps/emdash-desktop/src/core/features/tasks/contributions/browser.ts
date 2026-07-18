import { addRemoteModal } from '../browser/add-remote-modal';
import { taskModal } from '../browser/create-task-modal/create-task-modal';
import { deleteTaskModal } from '../browser/delete-task-modal';
import { createPrModal } from '../browser/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { conflictDialog } from '../browser/editor/conflict-dialog';
import { renameTaskModal } from '../browser/rename-task-modal';
import { taskViewRuntime } from '../browser/view';

export const tasksBrowserContributions = {
  views: [taskViewRuntime],
  modalDefs: [
    taskModal,
    conflictDialog,
    createPrModal,
    renameTaskModal,
    addRemoteModal,
    deleteTaskModal,
  ],
} as const;
