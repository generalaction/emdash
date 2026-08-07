import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { UpdateStore } from '@renderer/lib/stores/update-store';

// UpdateStore lives in renderer/lib because it depends on the renderer wire
// client and navigation, so its contribution is renderer-side and gets passed
// to createAppScope by the bootstrap alongside the core manifest.
const updateStoreToken = scopedStoreToken<UpdateStore>('updates.store');

export const updateAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: updateStoreToken,
    create: () => new UpdateStore(),
    activate: (store) => store.start(),
  }),
];

/** Returns the app-scoped UpdateStore. */
export function getUpdateStore(): UpdateStore {
  return getAppStores().get(updateStoreToken);
}
