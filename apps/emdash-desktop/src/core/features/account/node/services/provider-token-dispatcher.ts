import { err, ok, toSerializedError, type Result } from '@emdash/shared';
import type {
  providerTokenRegistry,
  ProviderTokenDispatchResult,
} from '@core/features/account/api/node/provider-token-registry';
import { type AccountProviderTokenPersistenceError, unknownErrorMessage } from '../account-errors';
import type { AuthProviderToken } from '../account-types';

export class ProviderTokenDispatcher {
  constructor(private readonly registry: Pick<typeof providerTokenRegistry, 'dispatch'>) {}

  async dispatchOptional(
    token: AuthProviderToken | undefined
  ): Promise<
    Result<ProviderTokenDispatchResult | undefined, AccountProviderTokenPersistenceError>
  > {
    if (!token) return ok();
    return this.dispatchRequired(token);
  }

  async dispatchRequired(
    token: AuthProviderToken
  ): Promise<
    Result<ProviderTokenDispatchResult | undefined, AccountProviderTokenPersistenceError>
  > {
    try {
      const result = await this.registry.dispatch(token.providerId, {
        accessToken: token.accessToken,
        providerAccount: token.providerAccount,
      });
      return ok(result);
    } catch (error) {
      return err({
        type: 'provider_token_persistence_failed',
        provider: token.providerId,
        message: unknownErrorMessage(error, 'Failed to persist provider token'),
        cause: toSerializedError(error),
      });
    }
  }
}
