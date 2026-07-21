import { err, ok, toSerializedError, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import { type AccountSessionPersistenceError, unknownErrorMessage } from '../account-errors';

const ACCOUNT_SESSION_SECRET_KEY = 'emdash-account-token';

export class AccountCredentialStore {
  constructor(
    private readonly secrets: SecretStore,
    private readonly logger: Pick<Logger, 'error'>
  ) {}

  async get(): Promise<Result<string | null, AccountSessionPersistenceError>> {
    try {
      return ok(await this.secrets.getSecret(ACCOUNT_SESSION_SECRET_KEY));
    } catch (error) {
      this.logger.error('Failed to retrieve session token', { error });
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to retrieve session token'),
        cause: toSerializedError(error),
      });
    }
  }

  async set(token: string): Promise<Result<void, AccountSessionPersistenceError>> {
    try {
      await this.secrets.setSecret(ACCOUNT_SESSION_SECRET_KEY, token);
      return ok();
    } catch (error) {
      this.logger.error('Failed to store session token', { error });
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to store session token'),
        cause: toSerializedError(error),
      });
    }
  }

  async clear(): Promise<Result<void, AccountSessionPersistenceError>> {
    try {
      await this.secrets.deleteSecret(ACCOUNT_SESSION_SECRET_KEY);
      return ok();
    } catch (error) {
      this.logger.error('Failed to clear session token', { error });
      return err({
        type: 'session_persistence_failed',
        message: unknownErrorMessage(error, 'Failed to clear session token'),
        cause: toSerializedError(error),
      });
    }
  }
}
