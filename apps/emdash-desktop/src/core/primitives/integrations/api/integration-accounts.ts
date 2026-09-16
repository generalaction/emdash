/**
 * The one shared issue-tracker integration account summary. Used everywhere an
 * account is passed around (Wire DTOs, node services, resolver inputs). Derive
 * from this type instead of redeclaring the shape.
 *
 * Workspace identity (`workspaceLabel`) is kept separate from the credential
 * owner (`displayName`) so token rotation never rewrites which workspace a
 * project points at. Carries NO credential material.
 */
export interface IntegrationAccountSummary {
  /** `provider_accounts` row account id, e.g. `linear:<orgId>`. */
  accountId: string;
  /** Owning integration, e.g. `linear`. */
  integrationId: string;
  /** Credential owner / viewer display name. */
  displayName?: string;
  /** Workspace or organization label, distinct from the credential owner. */
  workspaceLabel?: string;
  isDefault: boolean;
  health?: IntegrationAccountHealth;
}

/**
 * Per-account connection health. `unknown`/`checking` are transient; `invalid`
 * (bad credential) is distinct from `unreachable` (network) so the UI can offer
 * the right recovery.
 */
export type IntegrationAccountHealth =
  | { status: 'unknown' }
  | { status: 'checking' }
  | { status: 'ok'; checkedAt: number }
  | { status: 'invalid'; checkedAt: number; error?: string }
  | { status: 'unreachable'; checkedAt: number; error?: string };

export type IntegrationAccountState = {
  connected: boolean;
  accounts: IntegrationAccountSummary[];
  defaultAccountId: string | null;
};

export type IntegrationSetDefaultAccountResponse =
  | { success: true; account: IntegrationAccountSummary }
  | { success: false; error: string };

export type IntegrationRemoveAccountResponse =
  | { success: true; accounts: IntegrationAccountSummary[] }
  | { success: false; error: string };
