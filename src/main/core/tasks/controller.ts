import { createRPCController } from '@shared/ipc/rpc';
import { generateTaskName } from './name-generation/generateTaskName';
import { archiveTask } from './operations/archiveTask';
import { createTask } from './operations/createTask';
import { deleteTask } from './operations/deleteTask';
import { getTasks } from './operations/getTasks';
import { getWorkspaceSettings } from './operations/getWorkspaceSettings';
import { renameTask } from './operations/renameTask';
import { restoreTask } from './operations/restoreTask';
import { setTaskPinned } from './operations/setTaskPinned';
import { teardownTask } from './operations/teardownTask';
import { updateLinkedIssue } from './operations/updateLinkedIssue';
import { updateTaskStatus } from './operations/updateTaskStatus';
import { provisionTask } from './provisionTask';

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
  getWorkspaceSettings,
  updateLinkedIssue,
  updateTaskStatus,
  setTaskPinned,
});
