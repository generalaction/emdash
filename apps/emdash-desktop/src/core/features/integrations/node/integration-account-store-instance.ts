import type { IntegrationAccountStore } from './integration-account-store';

let integrationAccountStore: IntegrationAccountStore | undefined;

export function setIntegrationAccountStore(store: IntegrationAccountStore): void {
  integrationAccountStore = store;
}

export function getIntegrationAccountStore(): IntegrationAccountStore {
  if (!integrationAccountStore) {
    throw new Error('Integration credential store has not been configured');
  }
  return integrationAccountStore;
}
