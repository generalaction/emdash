import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { db } from '@main/db/client';
import { ProviderAccountRegistry } from './provider-account-registry';

export const providerAccountRegistry = new ProviderAccountRegistry(db, encryptedAppSecretsStore);
