import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../../src/live/protocol/index';
import { LiveState } from '../../src/live/state/index';

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  filter: z.enum(['all', 'open', 'done']),
});

export type TaskListState = z.infer<typeof taskListSchema>;

const initialState: TaskListState = {
  tasks: [{ id: 'task-1', title: 'Read the plan', done: false }],
  filter: 'all',
};

const server = new LiveState<TaskListState>(initialState, 1000);

export async function fetchSnapshot(): Promise<LiveSnapshot<TaskListState>> {
  return server.snapshot();
}

export function attach(push: (update: LiveUpdate) => void): Unsubscribe {
  return server.subscribe(push);
}

export function addTask(title: string, mutationId: string): LiveCursor {
  return server.produce(
    (draft) => {
      draft.tasks.push({ id: `task-${draft.tasks.length + 1}`, title, done: false });
    },
    { mutationIds: [mutationId] }
  );
}

export function completeTask(id: string): LiveCursor {
  return server.produce((draft) => {
    const task = draft.tasks.find((candidate) => candidate.id === id);
    if (task) task.done = true;
  });
}

export function reseedAndTouch(): void {
  server.reseed({
    tasks: [{ id: 'task-1', title: 'Server reset after reconnect', done: true }],
    filter: 'done',
  });
  server.produce((draft) => {
    draft.filter = 'all';
  });
}
