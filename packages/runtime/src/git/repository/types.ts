import type { BoundExec } from '@emdash/core/exec';
import type { RepositoryIdentity } from '../identity/types';

export type GitRepositoryOptions = {
  identity: RepositoryIdentity;
  exec: BoundExec;
};
