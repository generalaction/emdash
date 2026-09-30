import { scopedStoreToken } from '@core/primitives/scoped-stores/browser';
import type { GitCheckoutStore } from '../../browser/stores/git-checkout-store';

export const gitCheckoutStoreToken = scopedStoreToken<GitCheckoutStore>('source-control.checkout');
