import {
  denormalizeDiffTarget,
  type gitCheckoutContract,
  type GitContract,
} from '@emdash/core/git';
import type { ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { withLease, withLeaseResult, withLeaseValue, toJobError } from './lease';

type CheckoutEndpoints = NonNullable<ContractImpl<GitContract>['checkout']>;
type CheckoutModel = typeof gitCheckoutContract.model;
type FileDiffModel = typeof gitCheckoutContract.fileDiff;

export function createCheckoutEndpoints(
  runtime: GitRuntime,
  model: LeasedLiveModelProvider<CheckoutModel>,
  fileDiff: LeasedLiveModelProvider<FileDiffModel>
): CheckoutEndpoints {
  return {
    model,
    fileDiff,
    getFileDiff: (input) =>
      withLeaseResult(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) =>
          checkout.getFileDiff(
            input.path,
            input.target ? denormalizeDiffTarget(input.target) : undefined
          )
        )
      ),
    getChangedFiles: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getChangedFiles(denormalizeDiffTarget(input.target)))
      ),
    getConflictVersions: (input) =>
      withLeaseResult(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getConflictVersions(input.path))
      ),
    getFileAtRef: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getFileAtRef(input.filePath, input.ref))
      ),
    getFileAtIndex: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getFileAtIndex(input.filePath))
      ),
    getImageAtRef: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getImageAtRef(input.filePath, input.ref))
      ),
    getImageAtIndex: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getImageAtIndex(input.filePath))
      ),
    getLog: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getLog(input.options))
      ),
    getCommit: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getCommit(input.hash))
      ),
    getCommitFiles: (input) =>
      withLeaseValue(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.getCommitFiles(input.hash))
      ),
    blame: (input) =>
      withLeaseResult(runtime.acquireCheckout(input), (handle) =>
        handle.query((checkout) => checkout.blame(input.path, input.ref))
      ),
    push: {
      run: (input, context) =>
        withLease(runtime.acquireCheckout(input), (handle) =>
          handle.runJob('push', (checkout) =>
            checkout.push(input.options, {
              signal: context.signal,
              onProgress: context.progress,
            })
          )
        ),
      toError: toJobError,
    },
    pull: {
      run: (input, context) =>
        withLease(runtime.acquireCheckout(input), (handle) =>
          handle.runJob(
            'pull',
            (checkout) => checkout.pull({ signal: context.signal, onProgress: context.progress }),
            { objectTransfer: true }
          )
        ),
      toError: toJobError,
    },
    sync: {
      run: (input, context) =>
        withLease(runtime.acquireCheckout(input), (handle) =>
          handle.runJob(
            'sync',
            (checkout) => checkout.sync({ signal: context.signal, onProgress: context.progress }),
            { objectTransfer: true }
          )
        ),
      toError: toJobError,
    },
  };
}
