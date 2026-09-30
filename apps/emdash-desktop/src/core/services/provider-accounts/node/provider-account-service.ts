import {
  sortProviderAccountsByDefault,
  toProviderAccountSummary,
} from '@core/primitives/provider-accounts/api';
import type { ProviderAccount, ProviderAccountStore } from '../api/provider-account-store';

/** Shared inventory/default recovery; consumers choose their display ordering. */
export async function listProviderAccountSummaries(
  store: Pick<ProviderAccountStore, 'listAccounts' | 'getDefaultAccountId'>,
  providerId: string
) {
  const defaultAccountId = await store.getDefaultAccountId(providerId);
  return (await store.listAccounts(providerId)).map((account) =>
    toProviderAccountSummary({ ...account, isDefault: account.accountId === defaultAccountId })
  );
}

/** Shared account lifecycle. Authentication and secret decoding stay at provider edges. */
export class ProviderAccountService {
  constructor(
    private readonly store: ProviderAccountStore,
    private readonly hooks: {
      prepare?: (providerId: string) => Promise<void>;
      onRemoved?: (account: ProviderAccount) => void;
      onAccountsChanged?: (providerId: string) => void;
    } = {}
  ) {}

  async listAccounts(providerId: string) {
    await this.hooks.prepare?.(providerId);
    return sortProviderAccountsByDefault(
      await listProviderAccountSummaries(this.store, providerId)
    );
  }

  async setDefaultAccount(providerId: string, accountId: string) {
    await this.hooks.prepare?.(providerId);
    const account = await this.store.setDefaultAccount(providerId, accountId);
    if (account) this.hooks.onAccountsChanged?.(providerId);
    return account;
  }

  async removeAccount(providerId: string, accountId: string) {
    await this.hooks.prepare?.(providerId);
    const removed = await this.store.removeAccount(providerId, accountId);
    if (removed) {
      this.hooks.onRemoved?.(removed);
      this.hooks.onAccountsChanged?.(providerId);
    }
    return removed;
  }
}

let providerAccountService: ProviderAccountService | undefined;

export function setProviderAccountService(service: ProviderAccountService): void {
  providerAccountService = service;
}

export function getProviderAccountService(): ProviderAccountService {
  if (!providerAccountService) throw new Error('Provider account service has not been configured');
  return providerAccountService;
}
