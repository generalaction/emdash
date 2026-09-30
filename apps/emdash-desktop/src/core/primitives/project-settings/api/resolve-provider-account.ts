import { normalizeRepositoryHost } from '@core/primitives/repository/api';
import type { Resolved } from './effective-settings';
import type { StoredIntegrationAccount } from './project-settings';

/**
 * The one provider-account resolution algorithm (spec: github-git-settings
 * §2, §7, generalized to every provider). A stored choice resolves as:
 *
 * - `{ kind: 'none' }` → explicit suppression: `null` with `set` provenance.
 * - `{ kind: 'account' }` → that account with `set` provenance; a dangling
 *   pin — or, under host matching, a host-mismatched pin — fails closed to
 *   `null` with `unresolvable` provenance, never another identity.
 * - absence → inference. Without host matching: the provider default account
 *   (or the first account as self-healing fallback). With host matching: the
 *   default account if its host matches → the only host-matching account →
 *   none; an unknown repository host infers nothing.
 *
 * Repository-scoped operations supply host matching for every integration.
 * Other operations use provider defaults. Project-account resolution in both
 * renderer and node delegates here.
 */

/** Minimal account shape the resolver needs; callers keep their richer types. */
export type ResolvableProviderAccount = {
  accountId: string;
  isDefault: boolean;
};

/**
 * Host-matching context for providers whose accounts belong to specific
 * hosts. `host: null` means the repository host is unknown: explicit pins
 * pass (unknown is not mismatch evidence) and inference finds nothing.
 */
export type ProviderAccountHostMatching<A> = {
  host: string | null;
  hostOf(account: A): string;
  normalize(host: string): string;
};

/** Common repository-host policy for integrations, including rows predating host metadata. */
export function providerAccountHostMatching(
  host: string | null
): ProviderAccountHostMatching<ResolvableProviderAccount & { host?: string }> {
  return {
    host,
    // Legacy defaults remain usable; the provider validates its credential
    // endpoint against the resource before making an authenticated request.
    hostOf: (account) => account.host ?? host ?? '',
    normalize: normalizeRepositoryHost,
  };
}

export function resolveProviderAccount<A extends ResolvableProviderAccount>(
  stored: StoredIntegrationAccount | undefined,
  accounts: A[],
  hostMatching?: ProviderAccountHostMatching<NoInfer<A>>
): Resolved<A | null> {
  if (stored?.kind === 'none') {
    return { value: null, provenance: { kind: 'set' } };
  }

  if (stored?.kind === 'account') {
    const pinned = accounts.find((account) => account.accountId === stored.accountId);
    // Fail closed: a dangling or host-mismatched pin never becomes another
    // identity. An unknown repository host is not mismatch evidence.
    if (!pinned) return { value: null, provenance: { kind: 'unresolvable' } };
    if (
      hostMatching &&
      hostMatching.host !== null &&
      !matchesHost(pinned, { ...hostMatching, host: hostMatching.host })
    ) {
      return { value: null, provenance: { kind: 'unresolvable' } };
    }
    return { value: pinned, provenance: { kind: 'set' } };
  }

  if (!hostMatching) {
    const fallback = accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;
    return { value: fallback, provenance: { kind: 'inferred', from: 'default account' } };
  }

  if (hostMatching.host !== null) {
    return resolveProviderAccountForHost(accounts, { ...hostMatching, host: hostMatching.host });
  }
  return { value: null, provenance: { kind: 'inferred', from: 'no host-matching account' } };
}

/**
 * The single "default account for host" definition (spec §2): the provider
 * default account if its host matches → the only account whose host matches →
 * none. No other host-scoped default-account inference may exist.
 */
export function resolveProviderAccountForHost<A extends ResolvableProviderAccount>(
  accounts: A[],
  hostMatching: ProviderAccountHostMatching<NoInfer<A>> & { host: string }
): Resolved<A | null> {
  const defaultAccount = accounts.find((account) => account.isDefault);
  if (defaultAccount && matchesHost(defaultAccount, hostMatching)) {
    return { value: defaultAccount, provenance: { kind: 'inferred', from: 'default account' } };
  }
  const matching = accounts.filter((account) => matchesHost(account, hostMatching));
  if (matching.length === 1 && matching[0]) {
    return {
      value: matching[0],
      provenance: { kind: 'inferred', from: 'only host-matching account' },
    };
  }
  return { value: null, provenance: { kind: 'inferred', from: 'no host-matching account' } };
}

function matchesHost<A>(
  account: A,
  hostMatching: ProviderAccountHostMatching<A> & { host: string }
): boolean {
  return (
    hostMatching.normalize(hostMatching.hostOf(account)) ===
    hostMatching.normalize(hostMatching.host)
  );
}

/** A resolution and the exact inventory it observed, for account-bound requests. */
export type ProviderAccountResolutionSnapshot<A> = Resolved<A | null> & {
  accounts: A[];
  contextKey: string;
};

/** Stable across inventory ordering and display-only metadata changes. */
export function providerAccountContextKey(
  choice: StoredIntegrationAccount | undefined,
  accounts: (ResolvableProviderAccount & { host?: string })[]
): string {
  return JSON.stringify({
    choice: choice ?? null,
    accounts: [...accounts]
      .sort((a, b) => a.accountId.localeCompare(b.accountId))
      .map((account) => [account.accountId, account.isDefault, account.host ?? null]),
  });
}
