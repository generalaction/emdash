import { LiveStateClient } from '../../src/live/state/index';
import {
  attach,
  enqueueRename,
  enqueueWrite,
  fetchSnapshot,
  fileTreeSchema,
  flushBatch,
} from './server';

async function main(): Promise<void> {
  const client = new LiveStateClient(fileTreeSchema, fetchSnapshot, (value) => {
    console.log('client file tree:', value);
  });

  client.seed(await fetchSnapshot());
  const detach = attach((update) => {
    console.log('batched update mutationIds:', update.mutationIds);
    client.applyUpdate(update);
  });

  const renameMutationId = 'batch-rename';
  const writeMutationId = 'batch-write';
  const renameSettled = client.waitForMutation(renameMutationId);
  const writeSettled = client.waitForMutation(writeMutationId);

  enqueueRename('src/old.ts', 'src/new.ts', renameMutationId);
  enqueueWrite('README.md', '# Example', writeMutationId);
  console.log('queued two changes; client still sees:', client.getSnapshot());

  const cursor = flushBatch();
  await Promise.all([renameSettled, writeSettled]);
  if (cursor) await client.waitForCursor(cursor);
  console.log('single coalesced batch reached cursor:', cursor);

  detach();
}

void main();
