import type { BoundExec } from '@emdash/core/exec';
import type { IGitRepository } from '@emdash/core/git';

export type CheckoutRepository = Pick<IGitRepository, 'gitCommonDir' | 'readBlobAtRef'>;

export type GitCheckoutOptions = {
  checkoutPath: string;
  gitDir: string;
  repository: CheckoutRepository;
  exec: BoundExec;
};
