import type { BoundExec } from '@emdash/core/exec';
import type { CheckoutIdentity } from '../identity/types';

export type GitObjectReader = {
  readBlobAtRef(ref: string, filePath: string): Promise<string | null>;
};

/** @deprecated Use GitObjectReader. */
export type CheckoutRepository = GitObjectReader;

export type GitCheckoutOptions = {
  identity: CheckoutIdentity;
  objectReader: GitObjectReader;
  exec: BoundExec;
};
