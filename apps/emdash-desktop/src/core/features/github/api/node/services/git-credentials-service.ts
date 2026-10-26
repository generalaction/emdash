import type {
  GitCredentialChannel,
  GitCredentialsSessionSpec,
} from '@emdash/core/primitives/git-credentials/api';
import { isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import {
  normalizeRepositoryHost,
  parseRepositoryRef,
} from '@emdash/core/primitives/repository/api';
import type { GitOperationCredentials } from '@emdash/core/runtimes/git/api';
import type { Logger } from '@emdash/shared/logger';
import type { ProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/project-integration-account-resolver';
import { isGitHubAccountSummary } from '@core/primitives/github/api';
import {
  resolveProviderAccount,
  type AgentGitCredentialsSetting,
} from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import type {
  ProviderAccountRef,
  ProviderAccountSummary,
} from '@core/primitives/provider-accounts/api/provider-account-summary';

/**
 * Policy seam for the emdash git credential helper
 * (spec: github-git-settings §4):
 *
 * - agent/terminal PTY sessions get a session spec derived from the
 *   per-project "agent git credentials" setting and the effective account.
 *   A session keeps one channel while it runs (hydrating it again reuses it),
 *   and its session runtime releases the channel when the session ends;
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
  | GitCredentialProjectTarget
  | { kind: 'account'; accountId: string; host: string; providerId?: 'github' | 'gitlab' };

export type GitCredentialProjectTarget = {
  kind: 'project';
  projectId: string;
  providerId?: 'github' | 'gitlab';
};

export type GitCredentialChannelServer = {
  /** A new operation-scoped channel; the caller revokes it when the operation ends. */
  mintSession(target: GitCredentialSessionTarget): Promise<GitCredentialChannel>;
  /**
   * The channel for PTY session `sessionId`: the one it already has while that is live
   * and serves `target`, so reattaching never mints; otherwise a new one. The session
   * runtime revokes it once no session runs with it.
   */
  channelForSession(
    sessionId: string,
    target: GitCredentialProjectTarget
  ): Promise<GitCredentialChannel>;
  revokeSession(nonce: string): void;
};

export type GitOperationCredentialsLease = {
  credentials: GitOperationCredentials;
  release(): void;
};

export type GitCredentialsService = {
  /**
   * Session-env spec for an agent/terminal PTY session of a project workspace, keyed
   * by its PTY session id so a live session keeps its credential channel.
   */
  resolveSessionSpec(params: {
    sessionId: string;
    projectId: string;
    host: HostRef;
  }): Promise<GitCredentialsSessionSpec | undefined>;
  /** Operation-scoped credentials for emdash's own git ops in a project. */
  mintOperationCredentials(params: {
    projectId: string;
    host: HostRef;
    account?: ProviderAccountRef;
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
  listAccounts(providerId?: 'github' | 'gitlab'): Promise<ProviderAccountSummary[]>;
  channels: GitCredentialChannelServer;
  logger: Logger;
};

export function createGitCredentialsService(
  deps: GitCredentialsServiceDeps
): GitCredentialsService {
  const resolveEffectiveAccount = async (projectId: string) => {
    const candidates = await Promise.all(
      (['github', 'gitlab'] as const).map(async (providerId) => {
        const resolution = await deps.resolveProjectIntegrationAccount(projectId, providerId, {
          kind: 'project',
        });
        if (resolution.provenance.kind === 'unresolvable') {
          deps.logger.warn('Git credentials: project account pin is unresolvable', {
            projectId,
            providerId,
          });
        }
        const account = resolution.value;
        if (!account || account.providerId !== providerId || !account.host) return null;
        if (providerId === 'github' && !isGitHubAccountSummary(account)) return null;
        return { providerId, account };
      })
    );
    const matched = candidates.filter((candidate) => candidate !== null);
    return matched.length === 1 ? matched[0]! : null;
  };

  const mintProjectLease = async (
    projectId: string,
    accountHost: string,
    providerId: 'github' | 'gitlab'
  ): Promise<GitOperationCredentialsLease> => {
    const channel = await deps.channels.mintSession({ kind: 'project', projectId, providerId });
    return {
      credentials: { port: channel.port, nonce: channel.nonce, host: accountHost },
      release: () => deps.channels.revokeSession(channel.nonce),
    };
  };

  const mintAccountLease = async (
    account: ProviderAccountRef
  ): Promise<GitOperationCredentialsLease> => {
    if (account.providerId !== 'github' && account.providerId !== 'gitlab') {
      throw new Error(`Managed Git credentials are not supported for ${account.providerId}.`);
    }
    const selected = (await deps.listAccounts(account.providerId)).find(
      (candidate) =>
        candidate.providerId === account.providerId && candidate.accountId === account.accountId
    );
    if (!selected?.host) throw new Error('The selected Git account is unavailable.');
    const accountHost = normalizeRepositoryHost(selected.host);
    const channel = await deps.channels.mintSession({
      kind: 'account',
      providerId: account.providerId,
      accountId: account.accountId,
      host: accountHost,
    });
    return {
      credentials: { port: channel.port, nonce: channel.nonce, host: accountHost },
      release: () => deps.channels.revokeSession(channel.nonce),
    };
  };

  return {
    async resolveSessionSpec({ sessionId, projectId, host }) {
      const setting = await deps.getAgentGitCredentialsSetting(projectId);
      if (setting === 'none') return { mode: 'none' };
      if (setting === 'system') return { mode: 'system' };
      if (!isLocalHostRef(host)) return undefined;

      const account = await resolveEffectiveAccount(projectId);
      if (!account) return undefined;
      const channel = await deps.channels.channelForSession(sessionId, {
        kind: 'project',
        projectId,
        providerId: account.providerId,
      });
      return {
        mode: 'effective-account',
        channel,
        hosts: [normalizeRepositoryHost(account.account.host!)],
      };
    },

    async mintOperationCredentials({ projectId, host, account: selectedAccount }) {
      if (!isLocalHostRef(host)) return undefined;
      if (selectedAccount) return mintAccountLease(selectedAccount);
      const account = await resolveEffectiveAccount(projectId);
      if (!account) return undefined;
      return mintProjectLease(
        projectId,
        normalizeRepositoryHost(account.account.host!),
        account.providerId
      );
    },

    async mintCloneCredentials({ repositoryUrl, host, account }) {
      if (!isLocalHostRef(host)) return undefined;
      // Only HTTPS clones go through the helper; SSH remotes stay untouched.
      if (!/^https:\/\//i.test(repositoryUrl.trim())) return undefined;
      const ref = parseRepositoryRef(repositoryUrl);
      if (!ref) return undefined;

      const cloneHost = normalizeRepositoryHost(ref.host);
      let providers: Array<'github' | 'gitlab'>;
      if (account) {
        if (account.providerId !== 'github' && account.providerId !== 'gitlab') {
          throw new Error(`Managed Git credentials are not supported for ${account.providerId}.`);
        }
        providers = [account.providerId];
      } else if (cloneHost === 'github.com') {
        providers = ['github'];
      } else if (cloneHost === 'gitlab.com') {
        providers = ['gitlab'];
      } else {
        providers = ['github', 'gitlab'];
      }
      const candidates = (
        await Promise.all(
          providers.map(async (providerId) => {
            const accounts = (await deps.listAccounts(providerId)).filter(
              (candidate) => candidate.providerId === providerId
            );
            const selected = resolveProviderAccount(
              account ? { kind: 'account', accountId: account.accountId } : undefined,
              accounts,
              providerAccountHostMatching(cloneHost)
            ).value;
            return selected ? { providerId, account: selected } : null;
          })
        )
      ).filter((candidate) => candidate !== null);
      if (candidates.length > 1) {
        throw new Error('More than one connected integration matches the repository host.');
      }
      const selected = candidates[0];
      if (!selected) {
        if (account) {
          throw new Error(
            'The selected clone account is unavailable or does not match the repository host.'
          );
        }
        return undefined;
      }
      const channel = await deps.channels.mintSession({
        kind: 'account',
        accountId: selected.account.accountId,
        host: cloneHost,
        providerId: selected.providerId,
      });
      return {
        credentials: { port: channel.port, nonce: channel.nonce, host: cloneHost },
        release: () => deps.channels.revokeSession(channel.nonce),
      };
    },
  };
}
