import { MachinesStore } from '@core/features/machines/browser/machines-store';
import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const machinesStoreToken = scopedStoreToken<MachinesStore>('machines.store');

export const machinesAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: machinesStoreToken,
    // The projects store is resolved through the lookup at callback time, not
    // at construction, so contribution order between the two slices is free.
    create: (_context, stores) =>
      new MachinesStore({
        onConnectionReady: (connectionId) => {
          stores.get(projectManagerStoreToken).onSshConnectionReady(connectionId);
        },
      }),
    activate: (store) => void store.start(),
    dispose: (store) => store.dispose(),
  }),
];

/** Returns the app-scoped MachinesStore. */
export function getMachinesStore(): MachinesStore {
  return getAppStores().get(machinesStoreToken);
}
