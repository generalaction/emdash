import { HostTrustStore } from '@core/features/machines/browser/host-trust-store';
import { MachinesStore } from '@core/features/machines/browser/machines-store';
import { log } from '@core/primitives/logging/browser/logger';
import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const machinesStoreToken = scopedStoreToken<MachinesStore>('machines.store');

export const machinesAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: scopedStoreToken<HostTrustStore>('machines.host-trust'),
    create: () => new HostTrustStore(),
    activate: (store) => {
      void store.start().catch((error) => log.error('Could not start SSH trust prompts', error));
    },
    dispose: (store) => {
      void store.dispose().catch((error) => log.error('Could not close SSH trust prompts', error));
    },
  }),
  contributeScopedStore({
    token: machinesStoreToken,
    create: () => new MachinesStore(),
    activate: (store) => void store.start(),
    dispose: (store) => store.dispose(),
  }),
];

/** Returns the app-scoped MachinesStore. */
export function getMachinesStore(): MachinesStore {
  return getAppStores().get(machinesStoreToken);
}
