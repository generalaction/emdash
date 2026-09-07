import type { IntegrationCredentialStore } from './integration-credential-store';

let integrationCredentialStore: IntegrationCredentialStore | undefined;

export function setIntegrationCredentialStore(store: IntegrationCredentialStore): void {
  integrationCredentialStore = store;
}

export function getIntegrationCredentialStore(): IntegrationCredentialStore {
  if (!integrationCredentialStore) {
    throw new Error('Integration credential store has not been configured');
  }
  return integrationCredentialStore;
}
