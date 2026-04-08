import { createRPCController } from '@shared/ipc/rpc';
import { archiveTask } from './archiveTask';
import { createTask } from './createTask';
import { deleteTask } from './deleteTask';
import { generateTaskName } from './generateTaskName';
import { getBootstrapStatus } from './getBootstrapStatus';
import { getTasks } from './getTasks';
import { getTaskSettings } from './getTaskSettings';
import { provisionTask } from './provisionTask';
import { renameTask } from './renameTask';
import { restoreTask } from './restoreTask';
import { setTaskPinned } from './setTaskPinned';
import { teardownTask } from './teardownTask';
import { updateLinkedIssue } from './updateLinkedIssue';
import { updateTaskStatus } from './updateTaskStatus';

export const taskController = createRPCController({
  createTask,
  getTasks,
  deleteTask,
  generateTaskName,
  archiveTask,
  restoreTask,
  renameTask,
  provisionTask,
  teardownTask,
  getBootstrapStatus,
  getTaskSettings,
  updateLinkedIssue,
  updateTaskStatus,
  setTaskPinned,
});
