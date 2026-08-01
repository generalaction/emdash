import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { db } from '@main/db/client';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopWithPhases } from '@shared/core/loops/loops';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
} from '@shared/core/tasks/tasks';
import { commitPreparedLoop, prepareNewLoop, type NewLoopAuthoringInput } from './loop-operations';
import type { LoopOperationError } from './types';

export type CreateTaskWithLoopParams = {
  task: CreateTaskParams;
  loop: Omit<NewLoopAuthoringInput, 'projectId' | 'taskId'>;
};

export type CreateTaskWithLoopSuccess = {
  task: CreateTaskSuccess;
  loop: LoopWithPhases;
};

type CreateTaskWithLoopError = LoopOperationError | CreateTaskError;

export async function createTaskWithLoop(
  params: CreateTaskWithLoopParams
): Promise<Result<CreateTaskWithLoopSuccess, CreateTaskWithLoopError>> {
  if (params.task.taskConfig.initialConversation) {
    return err({
      kind: 'invalid-input',
      message: 'Loop tasks cannot create a separate initial conversation',
    });
  }

  const preparedTask = await prepareCreateTask(params.task);
  if (!preparedTask.success) return preparedTask;

  const preparedLoop = prepareNewLoop({
    ...params.loop,
    projectId: params.task.projectId,
    taskId: params.task.id,
  });
  if (!preparedLoop.success) return preparedLoop;

  try {
    let taskCommit!: ReturnType<typeof commitCreateTask>;
    let loop!: LoopWithPhases;
    db.transaction((tx) => {
      taskCommit = commitCreateTask(preparedTask.data, tx);
      loop = commitPreparedLoop(preparedLoop.data, tx);
    });

    const task = finalizeCreateTask(preparedTask.data, taskCommit.taskRow, taskCommit.convRow);
    return ok({ task, loop });
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
