import type { ProviderAccountMeta } from '@core/primitives/provider-accounts/api';

export type ProviderAccountSecretStore = {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
};

export type ProviderAccount = {
  providerId: string;
  accountId: string;
  credentialRef: string;
  isDefault: boolean;
  meta: ProviderAccountMeta | null;
  createdAt: number;
  updatedAt: number;
};

export type ProviderAccountUpsert = {
  providerId: string;
  accountId: string;
  /** Omit to leave the stored secret unchanged during metadata-only updates. */
  secret?: string;
  /** Replaces supplied metadata while retaining the registry's fallback name; omit to preserve all metadata. */
  meta?: Omit<ProviderAccountMeta, 'version'>;
  /** Legacy secret key override for new rows. Existing credential references never change. */
  credentialRef?: string;
};

export type ProviderAccountUpsertResult = {
  account: ProviderAccount;
  status: 'created' | 'updated';
};

export interface ProviderAccountStore {
  upsertAccount(input: ProviderAccountUpsert): Promise<ProviderAccountUpsertResult>;
  listAccounts(providerId: string): Promise<ProviderAccount[]>;
  getAccount(providerId: string, accountId?: string): Promise<ProviderAccount | null>;
  getDefaultAccountId(providerId: string): Promise<string | null>;
  setDefaultAccount(providerId: string, accountId: string): Promise<ProviderAccount | null>;
  resolveSecret(providerId: string, accountId?: string): Promise<string | null>;
  removeAccount(providerId: string, accountId: string): Promise<ProviderAccount | null>;
  isConfigured(providerId: string): Promise<boolean>;
}
