import type { Task } from '../types/app';

export function upsertTaskInList(tasks: Task[], task: Task): Task[] {
  const existingIndex = tasks.findIndex(
    (existingTask) => existingTask.id === task.id || existingTask.path === task.path
  );

  if (existingIndex === -1) {
    return [task, ...tasks];
  }

  const existingTask = tasks[existingIndex];
  const taskOverrides = Object.fromEntries(
    Object.entries(task).filter(([, value]) => value !== undefined)
  ) as Partial<Task>;
  const nextTask: Task = {
    ...existingTask,
    ...taskOverrides,
    metadata: task.metadata ?? existingTask.metadata,
  };

  return tasks.map((existing, index) => (index === existingIndex ? nextTask : existing));
}
