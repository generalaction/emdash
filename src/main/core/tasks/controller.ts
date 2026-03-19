import { createRPCController } from '@shared/ipc/rpc';
import { archiveTask } from './archiveTask';
import { createTask } from './createTask';
import { deleteTask } from './deleteTask';
import { getTasks } from './getTasks';
import { provisionTask } from './provisionTask';
import { restoreTask } from './restoreTask';

export const taskController = createRPCController({
  createTask,
  getTasks,
  deleteTask,
  archiveTask,
  restoreTask,
  provisionTask,
});
