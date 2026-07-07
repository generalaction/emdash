import { LiveModelClient } from '../../src/live/model/index';
import {
  addTask,
  attach,
  completeTask,
  fetchSnapshot,
  reseedAndTouch,
  taskListSchema,
} from './server';

async function main(): Promise<void> {
  const client = new LiveModelClient(taskListSchema, fetchSnapshot, (value) => {
    console.log('client state:', value);
  });

  client.seed(await fetchSnapshot());
  const detach = attach((update) => client.applyUpdate(update));

  const mutationId = 'example-add-task';
  const mutationSettled = client.waitForMutation(mutationId);
  const addedAt = addTask('Apply the first patch', mutationId);
  await mutationSettled;
  console.log('mutation ID settled at cursor:', addedAt);

  const doneAt = completeTask('task-2');
  await client.waitForCursor(doneAt);
  console.log('cursor caught up:', client.cursor);

  reseedAndTouch();
  await waitFor(() => client.getSnapshot()?.tasks[0]?.title === 'Server reset after reconnect');
  console.log('resynced snapshot after generation change:', client.getSnapshot());

  detach();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for live-model example condition');
}

void main();
