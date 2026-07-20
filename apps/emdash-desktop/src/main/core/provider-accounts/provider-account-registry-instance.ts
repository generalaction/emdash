import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { ProviderAccountRegistry } from './provider-account-registry';

export const providerAccountRegistry = new ProviderAccountRegistry(
  undefined,
  encryptedAppSecretsStore
);
