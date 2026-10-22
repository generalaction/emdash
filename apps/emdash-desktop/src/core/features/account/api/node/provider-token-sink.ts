import type { ProviderAccountIdentity } from '@core/primitives/provider-accounts/api';

/** A provider access token issued by the auth server at sign-in or account linking. */
export type ProviderTokenPayload = {
  accessToken: string;
  /** Epoch milliseconds; absent for tokens that do not expire. */
  expiresAt?: number;
  providerAccount?: ProviderAccountIdentity;
};

export type ProviderTokenDispatchResult = {
  providerAccountStatus?: 'created' | 'updated';
  providerAccount?: ProviderAccountIdentity;
};

/** Saves provider tokens from the auth server as connected integration accounts. */
export interface ProviderTokenSink {
  /** Whether accounts of `provider` can be linked through the auth server. */
  supports(provider: string): boolean;
  /** Saves the token; resolves `undefined` when `provider` is not supported. */
  store(
    provider: string,
    payload: ProviderTokenPayload
  ): Promise<ProviderTokenDispatchResult | undefined>;
}
