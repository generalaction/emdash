import type { Provenance, Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { providerAccountReportingState } from './account-reporting';

/**
 * React-free view state for the identity strip (spec: github-git-settings §9).
 * The strip shows who an account-relevant modal action (create PR, add remote,
 * create repository) will act as: a per-action override when the user picked
 * one in the popover, otherwise the blessed resolver's effective account.
 * Accountless outcomes map through the §7 reporting matrix so every surface
 * renders the same rows.
 */
export type IdentityStripView<Account extends ProviderAccountSummary> =
  | {
      kind: 'account';
      account: Account;
      /** `set` for an override or explicit pin, `inferred` for the silent default. */
      provenance: Provenance;
      /** True when the account was chosen in the popover for this action. */
      isActionOverride: boolean;
    }
  /** Explicit `{ kind: 'none' }` — quiet intent, not an error. */
  | { kind: 'disabled'; message: string }
  /** Zero accounts connected — the connect empty state. */
  | { kind: 'connect'; message: string }
  /** Accounts exist but none matches the repository host. */
  | { kind: 'no-match' }
  /** Dangling or host-mismatched pin — fail closed, never another identity. */
  | { kind: 'unresolvable'; message: string };

export function identityStripView<Account extends ProviderAccountSummary>(
  providerName: string,
  resolved: Resolved<Account | null>,
  override: Account | null,
  accounts: Account[]
): IdentityStripView<Account> {
  if (override) {
    return {
      kind: 'account',
      account: override,
      provenance: { kind: 'set' },
      isActionOverride: true,
    };
  }
  if (resolved.value) {
    return {
      kind: 'account',
      account: resolved.value,
      provenance: resolved.provenance,
      isActionOverride: false,
    };
  }
  const state = providerAccountReportingState(
    providerName,
    resolved.provenance,
    accounts.length > 0
  );
  switch (state.kind) {
    case 'disabled':
      return { kind: 'disabled', message: state.message };
    case 'connect':
      return { kind: 'connect', message: state.message };
    case 'silent':
      return { kind: 'no-match' };
    case 'unresolvable':
      return { kind: 'unresolvable', message: state.message };
  }
}
