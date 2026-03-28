import { createRPCController } from '@shared/ipc/rpc';
import { archiveTask } from './archiveTask';
import { createTask } from './createTask';
import { deleteTask } from './deleteTask';
import { getBootstrapStatus } from './getBootstrapStatus';
import { getTasks } from './getTasks';
import { getTaskSettings } from './getTaskSettings';
import { provisionTask } from './provisionTask';
import { renameTask } from './renameTask';
import { restoreTask } from './restoreTask';
import { teardownTask } from './teardownTask';
import { updateLinkedIssue } from './updateLinkedIssue';

export const taskController = createRPCController({
  createTask,
  getTasks,
  deleteTask,
  archiveTask,
  restoreTask,
  renameTask,
  provisionTask,
  teardownTask,
  getBootstrapStatus,
  getTaskSettings,
  updateLinkedIssue,
});
