import { z } from 'zod';
import type { ProviderAccountMeta } from './provider-account-meta';

/**
 * Renderer-facing summary of one connected provider account, built from the
 * `provider_accounts` row; never carries credential material. One shape for
 * every provider, with verified identity fields when the provider exposes them.
 */
export type ProviderAccountSummary = {
  providerId: string;
  accountId: string;
  isDefault: boolean;
  /** Human-readable account label, e.g. a Jira site, Linear workspace, or "@login". */
  displayName: string;
  /** Secondary detail, e.g. the account email or host. */
  displayDetail?: string;
  /** Provider login/username, when the provider has one. */
  login?: string;
  /** Provider host the account belongs to, e.g. "github.com". */
  host?: string;
  avatarUrl?: string;
  /** How the credential was obtained, e.g. 'form' | 'oauth' | 'device_flow' | 'cli'. */
  credentialSource?: string;
};

/** Connected accounts keyed by provider id. */
export type ProviderAccountsByProvider = Partial<Record<string, ProviderAccountSummary[]>>;

/** The common display projection, independent of each provider's secret codec. */
export function toProviderAccountSummary(account: {
  providerId: string;
  accountId: string;
  isDefault: boolean;
  meta: ProviderAccountMeta | null;
}): ProviderAccountSummary {
  const meta = account.meta;
  return {
    providerId: account.providerId,
    accountId: account.accountId,
    isDefault: account.isDefault,
    displayName:
      meta?.label?.trim() ||
      meta?.displayName?.trim() ||
      (meta?.login?.trim() ? `@${meta.login.trim()}` : undefined) ||
      meta?.fallbackDisplayName?.trim() ||
      'Unnamed account',
    ...(meta?.displayDetail || meta?.host
      ? { displayDetail: meta.displayDetail ?? meta.host }
      : {}),
    ...(meta?.login !== undefined ? { login: meta.login } : {}),
    ...(meta?.host ? { host: meta.host } : {}),
    ...(meta?.avatarUrl !== undefined ? { avatarUrl: meta.avatarUrl } : {}),
    ...(meta?.credentialSource ? { credentialSource: meta.credentialSource } : {}),
  };
}

/** Default-first, then by display name. */
export function sortProviderAccountsByDefault<A extends ProviderAccountSummary>(
  accounts: A[]
): A[] {
  return [...accounts].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

/** Stable reference to a saved integration account; carries no credentials. */
export const providerAccountRefSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1),
});
export type ProviderAccountRef = z.infer<typeof providerAccountRefSchema>;
