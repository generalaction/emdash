import { err, ok, toSerializedError, type Result } from '@agent/shared';
import type {
  ProviderTokenDispatchResult,
  ProviderTokenSink,
  ProviderTokenTarget,
} from '@core/features/account/api/node/provider-token-sink';
import { type AccountProviderTokenPersistenceError, unknownErrorMessage } from '../account-errors';
import type { AuthProviderToken } from '../account-types';

export class ProviderTokenDispatcher {
  constructor(private readonly sink: ProviderTokenSink) {}

  supports(provider: string): boolean {
    return this.sink.supports(provider);
  }

  async dispatchOptional(
    token: AuthProviderToken | undefined,
    target: ProviderTokenTarget = {}
  ): Promise<
    Result<ProviderTokenDispatchResult | undefined, AccountProviderTokenPersistenceError>
  > {
    if (!token) return ok();
    return this.dispatchRequired(token, target);
  }

  async dispatchRequired(
    token: AuthProviderToken,
    target: ProviderTokenTarget = {}
  ): Promise<
    Result<ProviderTokenDispatchResult | undefined, AccountProviderTokenPersistenceError>
  > {
    try {
      const result = await this.sink.store(
        token.providerId,
        {
          accessToken: token.accessToken,
          ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
          providerAccount: token.providerAccount,
        },
        target
      );
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
