import type {
  GitCredentialChannel,
  GitCredentialsSessionSpec,
} from '@emdash/core/primitives/git-credentials/api';
import { isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import type { GitOperationCredentials } from '@emdash/core/runtimes/git/api';
import type { Logger } from '@emdash/shared/logger';
import type { ProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/project-integration-account-resolver';
import { isGitHubAccountSummary, type GitHubAccountSummary } from '@core/primitives/github/api';
import {
  resolveProviderAccount,
  type AgentGitCredentialsSetting,
} from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountRef } from '@core/primitives/provider-accounts/api/provider-account-summary';
import { normalizeRepositoryHost, parseRepositoryRef } from '@core/primitives/repository/api';

/**
 * Policy seam for the emdash git credential helper
 * (spec: github-git-settings §4):
 *
 * - agent/terminal PTY sessions get a session spec derived from the
 *   per-project "agent git credentials" setting and the effective account;
 * - emdash's own git operations get operation-scoped credentials for the
 *   effective account on its host, revoked when the operation finishes.
 *
 * Channels only exist for local hosts: the credential server listens on the
 * desktop loopback, which a remote (SSH) workspace cannot reach. Remote
 * sessions and operations keep native credential behavior (recorded interim
 * limitation).
 */

/** Project sessions follow settings; explicit account sessions retain their selection. */
export type GitCredentialSessionTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'account'; accountId: string; host: string };

export type GitCredentialChannelServer = {
  mintSession(target: GitCredentialSessionTarget): Promise<GitCredentialChannel>;
  revokeSession(nonce: string): void;
};

export type GitOperationCredentialsLease = {
  credentials: GitOperationCredentials;
  release(): void;
};

export type GitCredentialsService = {
  /** Session-env spec for agent/terminal PTY sessions of a project workspace. */
  resolveSessionSpec(params: {
    projectId: string;
    host: HostRef;
  }): Promise<GitCredentialsSessionSpec | undefined>;
  /** Operation-scoped credentials for emdash's own git ops in a project. */
  mintOperationCredentials(params: {
    projectId: string;
    host: HostRef;
  }): Promise<GitOperationCredentialsLease | undefined>;
  /** Operation-scoped credentials for cloning an HTTPS URL (no project yet). */
  mintCloneCredentials(params: {
    repositoryUrl: string;
    host: HostRef;
    account?: ProviderAccountRef;
  }): Promise<GitOperationCredentialsLease | undefined>;
};

export type GitCredentialsServiceDeps = {
  getAgentGitCredentialsSetting(projectId: string): Promise<AgentGitCredentialsSetting>;
  resolveProjectIntegrationAccount: ProjectIntegrationAccountResolver;
  listAccounts(): Promise<GitHubAccountSummary[]>;
  channels: GitCredentialChannelServer;
  logger: Logger;
};

export function createGitCredentialsService(
  deps: GitCredentialsServiceDeps
): GitCredentialsService {
  const resolveEffectiveAccount = async (
    projectId: string
  ): Promise<GitHubAccountSummary | null> => {
    const resolution = await deps.resolveProjectIntegrationAccount(projectId, 'github', {
      kind: 'project',
    });
    if (resolution.value && isGitHubAccountSummary(resolution.value)) return resolution.value;
    if (resolution.provenance.kind === 'unresolvable') {
      // Fail closed on the emdash identity: a broken pin never resolves to
      // another account. Git itself degrades to native behavior (same as an
      // explicit "no account"), matching the decision-ticket scrub semantics.
      deps.logger.warn('Git credentials: project account pin is unresolvable; no emdash helper', {
        projectId,
      });
    }
    return null;
  };

  const mintProjectLease = async (
    projectId: string,
    accountHost: string
  ): Promise<GitOperationCredentialsLease> => {
    const channel = await deps.channels.mintSession({ kind: 'project', projectId });
    return {
      credentials: { port: channel.port, nonce: channel.nonce, host: accountHost },
      release: () => deps.channels.revokeSession(channel.nonce),
    };
  };

  return {
    async resolveSessionSpec({ projectId, host }) {
      const setting = await deps.getAgentGitCredentialsSetting(projectId);
      if (setting === 'none') return { mode: 'none' };
      if (setting === 'system') return { mode: 'system' };
      if (!isLocalHostRef(host)) return undefined;

      const account = await resolveEffectiveAccount(projectId);
      if (!account) return undefined;
      const channel = await deps.channels.mintSession({ kind: 'project', projectId });
      return {
        mode: 'effective-account',
        channel,
        hosts: [normalizeRepositoryHost(account.host)],
      };
    },

    async mintOperationCredentials({ projectId, host }) {
      if (!isLocalHostRef(host)) return undefined;
      const account = await resolveEffectiveAccount(projectId);
      if (!account) return undefined;
      return mintProjectLease(projectId, normalizeRepositoryHost(account.host));
    },

    async mintCloneCredentials({ repositoryUrl, host, account }) {
      if (!isLocalHostRef(host)) return undefined;
      // Only HTTPS clones go through the helper; SSH remotes stay untouched.
      if (!/^https:\/\//i.test(repositoryUrl.trim())) return undefined;
      const ref = parseRepositoryRef(repositoryUrl);
      if (!ref) return undefined;

      const cloneHost = normalizeRepositoryHost(ref.host);
      if (account && account.providerId !== 'github') {
        throw new Error(`Managed Git credentials are not supported for ${account.providerId}.`);
      }
      const resolved = resolveProviderAccount(
        account ? { kind: 'account', accountId: account.accountId } : undefined,
        await deps.listAccounts(),
        providerAccountHostMatching(cloneHost)
      );
      if (!resolved.value) {
        if (account)
          throw new Error(
            'The selected clone account is unavailable or does not match the repository host.'
          );
        // No explicit account and no host match: retain native Git behavior.
        return undefined;
      }

      const channel = await deps.channels.mintSession({
        kind: 'account',
        accountId: resolved.value.accountId,
        host: cloneHost,
      });
      return {
        credentials: { port: channel.port, nonce: channel.nonce, host: cloneHost },
        release: () => deps.channels.revokeSession(channel.nonce),
      };
    },
  };
}
