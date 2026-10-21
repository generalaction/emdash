import type { ProviderAccountMeta } from '@core/primitives/provider-accounts/api';

/** Decode historical GitHub rows once, before projecting any current account view. */
export function normalizeLegacyAccountMeta(
  providerId: string,
  accountId: string,
  meta: ProviderAccountMeta | null
): ProviderAccountMeta | null {
  if (providerId !== 'github') return meta;
  const separator = accountId.lastIndexOf(':');
  const source = meta?.credentialSource;
  return {
    ...meta,
    version: '1',
    host: meta?.host || (separator > 0 ? accountId.slice(0, separator) : 'github.com'),
    providerAccountId:
      meta?.providerAccountId ?? (separator > 0 ? accountId.slice(separator + 1) : accountId),
    login: meta?.login ?? '',
    avatarUrl: meta?.avatarUrl ?? '',
    credentialSource:
      source === 'cli' || source === 'emdash_oauth' || source === 'device_flow'
        ? source
        : 'secure_storage',
  };
}
