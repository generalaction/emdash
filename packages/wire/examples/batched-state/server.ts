import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../../src/live/protocol/index';
import { BatchedLiveState, LiveState } from '../../src/live/state/index';

export const fileTreeSchema = z.object({
  files: z.record(z.string(), z.string()),
});

export type FileTreeState = z.infer<typeof fileTreeSchema>;

const server = new LiveState<FileTreeState>(
  {
    files: {
      'src/old.ts': 'console.log("old");',
    },
  },
  2000
);

const batched = new BatchedLiveState<FileTreeState>(server, () => {
  // Keep flushing manual in the example so the client can see the batch boundary.
});

export async function fetchSnapshot(): Promise<LiveSnapshot<FileTreeState>> {
  return batched.snapshot();
}

export function attach(push: (update: LiveUpdate) => void): Unsubscribe {
  return batched.subscribe(push);
}

export function enqueueRename(from: string, to: string, mutationId: string): void {
  batched.enqueue(
    (draft) => {
      const content = draft.files[from];
      if (content === undefined) return;
      delete draft.files[from];
      draft.files[to] = content;
    },
    { mutationIds: [mutationId] }
  );
}

export function enqueueWrite(path: string, content: string, mutationId: string): void {
  batched.enqueue(
    (draft) => {
      draft.files[path] = content;
    },
    { mutationIds: [mutationId] }
  );
}

export function flushBatch(): LiveCursor | undefined {
  return batched.flush();
}
