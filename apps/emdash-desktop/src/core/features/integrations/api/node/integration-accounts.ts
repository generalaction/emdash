import type {
  IntegrationCredentials,
  VerifiedAccountIdentity,
  VerifyResult,
} from '@emdash/plugins/integrations';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import type { IntegrationConnectOptions } from '../contract';

export type IntegrationAccountRecord = {
  accountId: string;
  displayName?: string;
  label?: string;
  displayDetail?: string;
  identity?: VerifiedAccountIdentity;
  credentialSource?: string;
  credentials: IntegrationCredentials;
};

/** Credential consumers resolve one account; persistence stays with the integration owner. */
export interface IntegrationAccountReader {
  getAccount(providerId: string, accountId?: string): Promise<IntegrationAccountRecord | null>;
}

export type IntegrationConnectionResult =
  | {
      success: true;
      accountId: string;
      displayName?: string;
      displayDetail?: string;
      account: ProviderAccountSummary;
      status: 'created' | 'updated';
    }
  | { success: false; error: string };

/** Auth adapters finish a trusted authentication flow through the common account lifecycle. */
export interface IntegrationConnections {
  connectVerified(
    providerId: string,
    result: Extract<VerifyResult, { connected: true }>,
    options?: IntegrationConnectOptions & { credentialSource?: string }
  ): Promise<IntegrationConnectionResult>;
}
