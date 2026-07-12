import type { GitContract } from '@emdash/core/git';
import type { ContractImpl } from '@emdash/wire';
import type { GitCheckoutRuntime } from '../checkout/checkout-runtime';

type CheckoutImplementation = NonNullable<ContractImpl<GitContract>['checkout']>;

export function createCheckoutProcedures(runtime: GitCheckoutRuntime) {
  return {
    getFileDiff: (input) => runtime.getFileDiff(input),
    getChangedFiles: (input) => runtime.getChangedFiles(input),
    isFileTracked: (input) => runtime.isFileTracked(input),
    getConflictVersions: (input) => runtime.getConflictVersions(input),
    getFileAtRef: (input) => runtime.getFileAtRef(input),
    getFileAtIndex: (input) => runtime.getFileAtIndex(input),
    getImageAtRef: (input) => runtime.getImageAtRef(input),
    getImageAtIndex: (input) => runtime.getImageAtIndex(input),
    getLog: (input) => runtime.getLog(input),
    getCommit: (input) => runtime.getCommit(input),
    getCommitFiles: (input) => runtime.getCommitFiles(input),
    blame: (input) => runtime.blame(input),
    push: { run: (input, context) => runtime.push(input, context) },
    pull: { run: (input, context) => runtime.pull(input, context) },
    sync: { run: (input, context) => runtime.sync(input, context) },
  } satisfies Omit<CheckoutImplementation, 'model' | 'fileDiff'>;
}
