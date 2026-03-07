import { createRPCController } from '../../../shared/ipc/rpc';
import { archiveTask } from '../core/tasks/archiveTask';
import { createTask } from '../core/tasks/createTask';
import { deleteTask } from '../core/tasks/deleteTask';
import { getTasks } from '../core/tasks/getTasks';
import { restoreTask } from '../core/tasks/restoreTask';

export const taskController = createRPCController({
  createTask,
  getTasks,
  deleteTask,
  archiveTask,
  restoreTask,
});
