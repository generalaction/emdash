import {
  gitContract,
  type CheckoutKey,
  type CheckoutStatusModel,
  type GitHeadModel,
} from '@emdash/core/git';
import {
  createLiveModelHost,
  type LiveInstance,
  type LiveModelHost,
  type LiveModelHostMutationHandlers,
} from '@emdash/wire';

export type CheckoutModel = typeof gitContract.checkout.model;
export type CheckoutFileDiffModel = typeof gitContract.checkout.fileDiff;
export type CheckoutLiveHost = LiveModelHost<CheckoutModel>;
export type CheckoutLiveModels = LiveInstance<CheckoutModel>;

export type CheckoutInitialState = {
  status: CheckoutStatusModel;
  head: GitHeadModel;
};

export function createCheckoutLiveHost(
  mutations?: LiveModelHostMutationHandlers<CheckoutModel>
): CheckoutLiveHost {
  return createLiveModelHost(gitContract.checkout.model, { mutations });
}

export function createCheckoutLiveModels(
  host: CheckoutLiveHost,
  key: CheckoutKey,
  initialState: CheckoutInitialState
): CheckoutLiveModels {
  return host.create(key, initialState);
}
