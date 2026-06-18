import { err, ok, type Result } from '@emdash/shared';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { type AccountSessionPersistenceError, unknownErrorMessage } from '../account-errors';

const ACCOUNT_SESSION_SECRET_KEY = 'emdash-account-token';

export class AccountCredentialStore {
  async get(): Promise<Result<string | null, AccountSessionPersistenceError>> {
    try {
      return ok(await encryptedAppSecretsStore.getSecret(ACCOUNT_SESSION_SECRET_KEY));
    } catch (error) {
      log.error('Failed to retrieve session token:', error);
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to retrieve session token'),
        cause: error,
      });
    }
  }

  async set(token: string): Promise<Result<void, AccountSessionPersistenceError>> {
    try {
      await encryptedAppSecretsStore.setSecret(ACCOUNT_SESSION_SECRET_KEY, token);
      return ok();
    } catch (error) {
      log.error('Failed to store session token:', error);
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to store session token'),
        cause: error,
      });
    }
  }

  async clear(): Promise<Result<void, AccountSessionPersistenceError>> {
    try {
      await encryptedAppSecretsStore.deleteSecret(ACCOUNT_SESSION_SECRET_KEY);
      return ok();
    } catch (error) {
      log.error('Failed to clear session token:', error);
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to clear session token'),
        cause: error,
      });
    }
  }
}

export const accountCredentialStore = new AccountCredentialStore();
