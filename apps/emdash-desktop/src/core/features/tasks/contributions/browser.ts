import { addRemoteModal } from '../browser/add-remote-modal';
import { taskModal } from '../browser/create-task-modal/create-task-modal';
import { deleteTaskModal } from '../browser/delete-task-modal';
import { renameTaskModal } from '../browser/rename-task-modal';
import { taskViewRuntime } from '../browser/view';
import { taskPaletteProviderDefs } from './browser/task-palette-provider';

export const tasksBrowserContributions = {
  views: [taskViewRuntime],
  modalDefs: [taskModal, renameTaskModal, addRemoteModal, deleteTaskModal],
  paletteProviderDefs: taskPaletteProviderDefs,
} as const;
