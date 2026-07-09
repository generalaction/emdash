import {
  createLiveModelHost,
  type LiveInstance,
  type LiveModelHost,
  type LiveModelHostMutationHandlers,
} from '@emdash/wire';
import { gitContract } from '../api/contract';
import type { RepositoryKey } from './key';
import type { GitCheckoutsModel } from './models/checkouts';
import type { GitRefsModel } from './models/refs';
import type { GitRemotesModel } from './models/remotes';
import type { GitStashesModel } from './models/stashes';

export type RepositoryModel = typeof gitContract.repository.model;
export type RepositoryLiveHost = LiveModelHost<RepositoryModel>;
export type RepositoryLiveModels = LiveInstance<RepositoryModel>;

export type RepositoryInitialState = {
  refs: GitRefsModel;
  remotes: GitRemotesModel;
  stashes: GitStashesModel;
  checkouts: GitCheckoutsModel;
};

export function createRepositoryLiveHost(
  mutations?: LiveModelHostMutationHandlers<RepositoryModel>
): RepositoryLiveHost {
  return createLiveModelHost(gitContract.repository.model, { mutations });
}

export function createRepositoryLiveModels(
  host: RepositoryLiveHost,
  key: RepositoryKey,
  initialState: RepositoryInitialState
): RepositoryLiveModels {
  return host.create(key, initialState);
}
