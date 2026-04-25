import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';

const ACCOUNT_SESSION_SECRET_KEY = 'emdash-account-token';

export class AccountCredentialStore {
  async get(): Promise<string | null> {
    try {
      return await encryptedAppSecretsStore.getSecret(ACCOUNT_SESSION_SECRET_KEY);
    } catch (error) {
      log.error('Failed to retrieve session token:', error);
      return null;
    }
  }

  async set(token: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(ACCOUNT_SESSION_SECRET_KEY, token);
    } catch (error) {
      log.error('Failed to store session token:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(ACCOUNT_SESSION_SECRET_KEY);
    } catch (error) {
      log.error('Failed to clear session token:', error);
    }
  }
}

export const accountCredentialStore = new AccountCredentialStore();
