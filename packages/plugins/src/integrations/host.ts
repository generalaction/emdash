import type { Serializable } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';

/**
 * Credential values and derived account config for one connected account,
 * keyed by auth field id (form method) or well-known keys such as
 * `accessToken` (oauth method). Values may be structured (e.g. resolved
 * board ids); the whole record is stored encrypted, and plugins narrow it
 * to a provider-local credentials type.
 *
 * The host owns persistence: it stores the record returned by `verify` on
 * connect, deletes it on disconnect, and hands it back read-only for data
 * calls. Plugins never write credential storage.
 */
export type IntegrationCredentials = Record<string, Serializable>;

/** Host services available to every plugin behavior. */
export type IntegrationHostContext = {
  log: Logger;
};

/**
 * Context for feature-plugin data behaviors. The host loads stored
 * credentials before invoking the plugin and short-circuits with a uniform
 * not-connected error when none exist, so `credentials` is always present
 * here. The host scopes the context to one account, keeping plugins
 * account-agnostic.
 */
export type ConnectedIntegrationHostContext = IntegrationHostContext & {
  credentials: IntegrationCredentials;
};
