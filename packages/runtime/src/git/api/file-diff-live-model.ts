import { gitCheckoutContract } from '@emdash/core/git';
import { toPendingLease, type Lease } from '@emdash/shared';
import type { LeasedLiveModelProvider, LiveSource } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';

type FileDiffModel = typeof gitCheckoutContract.fileDiff;

export function createFileDiffLiveModelProvider(
  runtime: GitRuntime,
  contract: FileDiffModel = gitCheckoutContract.fileDiff
): LeasedLiveModelProvider<FileDiffModel> {
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState(key) {
      const handleLease = runtime.acquireCheckout({ checkout: key.checkout });
      return toPendingLease(
        (async (): Promise<Lease<LiveSource>> => {
          try {
            const handle = await handleLease.ready();
            const stateLease = handle.acquireFileDiffStaleness({
              filePath: key.filePath,
              target: key.target,
            });
            try {
              const source = await stateLease.ready();
              return {
                value: source,
                release: async () => {
                  await stateLease.release();
                  await handleLease.release();
                },
              };
            } catch (error) {
              await stateLease.release();
              throw error;
            }
          } catch (error) {
            await handleLease.release();
            throw error;
          }
        })()
      );
    },
    async runMutation(): Promise<never> {
      throw new Error('git.checkout.fileDiff has no mutations');
    },
    async dispose(): Promise<void> {},
  };
}
