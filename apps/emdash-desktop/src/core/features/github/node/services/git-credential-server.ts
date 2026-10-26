import crypto from 'node:crypto';
import http from 'node:http';
import {
  parseGitCredentialRequest,
  serializeGitCredentialResponse,
  GIT_CREDENTIAL_HELPER_ERASE_URL_PATH,
  GIT_CREDENTIAL_HELPER_URL_PATH,
  type GitCredentialChannel,
  type GitCredentialRequest,
} from '@emdash/core/primitives/git-credentials/api';
import { normalizeRepositoryHost } from '@emdash/core/primitives/repository/api';
import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import type {
  GitCredentialChannelServer,
  GitCredentialProjectTarget,
  GitCredentialSessionTarget,
} from '@core/features/github/api/node/services/git-credentials-service';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import type { ReadIntegrationCredentials } from '@core/features/integrations/api/node/integration-credential-reader';
import type { ProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/project-integration-account-resolver';
import { isGitHubAccountSummary } from '@core/primitives/github/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';

/**
 * Loopback credential server behind the emdash git credential helper
 * (spec: github-git-settings §4; secrets spec "first consumer" seam).
 *
 * Sessions carry only `{ port, nonce }` — the token stays desktop-side and is
 * read on every request. Project sessions follow the shared project resolver;
 * clone sessions keep their selected account. Removal or a broken pin fails
 * closed. The token travels exclusively over this loopback response body to
 * the helper's stdout; it is never logged and never enters an environment.
 */

export type GitCredentialServerDeps = {
  resolveProjectIntegrationAccount: ProjectIntegrationAccountResolver;
  listAccounts(providerId?: 'github' | 'gitlab'): Promise<ProviderAccountSummary[]>;
  readCredentials: ReadGitHubCredentials;
  readIntegrationCredentials?: ReadIntegrationCredentials;
  /** Git rejected these credentials (`erase`); the next read may renew them. */
  reportRejectedCredentials?(
    integrationId: string,
    accountId: string,
    credentials: IntegrationCredentials
  ): Promise<unknown>;
  logger: Logger;
};

const MAX_BODY_BYTES = 64 * 1024;
/** PTY-session channels live as long as the session; cap to bound the map. */
const MAX_SESSIONS = 512;

type Channel = {
  target: GitCredentialSessionTarget;
  /** The PTY session this channel was minted for; operation channels have none. */
  sessionId?: string;
};

export class GitCredentialServer implements GitCredentialChannelServer {
  private server: http.Server | null = null;
  private port = 0;
  private starting: Promise<number> | null = null;
  private readonly channels = new Map<string, Channel>();
  /** PTY session id -> nonce of the newest channel minted for that session. */
  private readonly sessionChannels = new Map<string, string>();

  constructor(private readonly deps: GitCredentialServerDeps) {}

  async mintSession(target: GitCredentialSessionTarget): Promise<GitCredentialChannel> {
    const port = await this.ensureStarted();
    return { port, nonce: this.register({ target }) };
  }

  async channelForSession(
    sessionId: string,
    target: GitCredentialProjectTarget
  ): Promise<GitCredentialChannel> {
    const port = await this.ensureStarted();
    const current = this.sessionChannels.get(sessionId);
    const currentTarget = current === undefined ? undefined : this.channels.get(current)?.target;
    if (current !== undefined && currentTarget && sameProjectTarget(currentTarget, target)) {
      return { port, nonce: current };
    }
    // A changed target needs a new channel. The old one stays valid while a live
    // session still runs with it; its runtime releases it when that session ends.
    const nonce = this.register({ target, sessionId });
    this.sessionChannels.set(sessionId, nonce);
    return { port, nonce };
  }

  revokeSession(nonce: string): void {
    const channel = this.channels.get(nonce);
    if (!channel) return;
    this.channels.delete(nonce);
    if (channel.sessionId !== undefined && this.sessionChannels.get(channel.sessionId) === nonce) {
      this.sessionChannels.delete(channel.sessionId);
    }
  }

  stop(): void {
    this.channels.clear();
    this.sessionChannels.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  private register(channel: Channel): string {
    const nonce = crypto.randomBytes(24).toString('hex');
    if (this.channels.size >= MAX_SESSIONS) {
      const oldest = this.channels.keys().next().value;
      if (oldest !== undefined) this.revokeSession(oldest);
    }
    this.channels.set(nonce, channel);
    return nonce;
  }

  private ensureStarted(): Promise<number> {
    if (this.server && this.port > 0) return Promise.resolve(this.port);
    if (this.starting) return this.starting;

    const server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server = server;
    this.starting = new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        this.port = addr && typeof addr === 'object' ? addr.port : 0;
        this.deps.logger.info('GitCredentialServer: started', { port: this.port });
        resolve(this.port);
      });
      server.on('error', (error) => {
        this.deps.logger.error('GitCredentialServer: failed to start', { error: String(error) });
        this.server = null;
        this.port = 0;
        this.starting = null;
        reject(error);
      });
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const operation =
      req.url === GIT_CREDENTIAL_HELPER_URL_PATH
        ? 'get'
        : req.url === GIT_CREDENTIAL_HELPER_ERASE_URL_PATH
          ? 'erase'
          : null;
    if (req.method !== 'POST' || !operation) {
      res.writeHead(404);
      res.end();
      return;
    }
    const nonce = String(req.headers['x-emdash-token'] ?? '');
    const target = nonce ? this.channels.get(nonce)?.target : undefined;
    if (!target) {
      this.deps.logger.warn('GitCredentialServer: rejected request with unknown session nonce');
      res.writeHead(403);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      const handled =
        operation === 'get' ? this.respond(target, body, res) : this.erase(target, body, res);
      handled.catch((error) => {
        // Never include the request body or credentials in logs.
        this.deps.logger.warn('GitCredentialServer: request failed', { error: String(error) });
        res.writeHead(500);
        res.end();
      });
    });
  }

  private async respond(
    target: GitCredentialSessionTarget,
    body: string,
    res: http.ServerResponse
  ): Promise<void> {
    const resolved = await this.resolveCredential(target, parseGitCredentialRequest(body));
    if (!resolved) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      serializeGitCredentialResponse({ username: resolved.username, password: resolved.token })
    );
  }

  /**
   * Git erases a credential after the remote rejected it. When it is the
   * account's current token, report it so the next read renews it (e.g. after
   * another device rotated a shared token). Nothing is written back to git.
   */
  private async erase(
    target: GitCredentialSessionTarget,
    body: string,
    res: http.ServerResponse
  ): Promise<void> {
    const request = parseGitCredentialRequest(body);
    const resolved = await this.resolveCredential(target, request);
    if (resolved && request.password === resolved.token) {
      this.deps.logger.info('GitCredentialServer: git rejected the current credential', {
        targetKind: target.kind,
        providerId: resolved.providerId,
        accountId: resolved.accountId,
      });
      await this.deps.reportRejectedCredentials?.(
        resolved.providerId,
        resolved.accountId,
        resolved.credentials
      );
    }
    res.writeHead(200);
    res.end();
  }

  /** The selected account's credential for a request, or `null` (fail closed). */
  private async resolveCredential(
    target: GitCredentialSessionTarget,
    request: GitCredentialRequest
  ): Promise<{
    providerId: 'github' | 'gitlab';
    accountId: string;
    credentials: IntegrationCredentials;
    username: string;
    token: string;
  } | null> {
    const requestHost = normalizeRepositoryHost(request.host ?? '');
    if (request.protocol !== 'https' || !requestHost) return null;

    const providerId = target.providerId ?? 'github';
    const account = await this.resolveAccount(target, requestHost, providerId);
    if (!account) {
      this.deps.logger.info('GitCredentialServer: no credential for request', {
        targetKind: target.kind,
        host: requestHost,
      });
      return null;
    }

    // Read only the selected account; removal or an endpoint mismatch fails closed.
    const credentials =
      providerId === 'github'
        ? await this.deps.readCredentials(account.accountId, requestHost)
        : await this.deps.readIntegrationCredentials?.('gitlab', account.accountId, requestHost);
    if (!credentials?.success) {
      this.deps.logger.warn('GitCredentialServer: token resolution failed closed', {
        targetKind: target.kind,
        host: requestHost,
        accountId: account.accountId,
      });
      return null;
    }

    const credential = credentials.data;
    // GitLab OAuth tokens authenticate Git over HTTPS only with the `oauth2` username.
    const gitLabOAuth = providerId === 'gitlab' && 'accessToken' in credential;
    const token =
      providerId === 'github' && 'accessToken' in credential
        ? credential.accessToken
        : gitLabOAuth
          ? credential.accessToken
          : providerId === 'gitlab' && 'apiToken' in credential
            ? credential.apiToken
            : null;
    if (typeof token !== 'string' || !token) return null;
    if (providerId === 'gitlab') {
      const instanceUrl = 'instanceUrl' in credential ? credential.instanceUrl : null;
      if (
        typeof instanceUrl !== 'string' ||
        normalizeRepositoryHost(new URL(instanceUrl).host) !== requestHost
      ) {
        return null;
      }
    }
    return {
      providerId,
      accountId: account.accountId,
      credentials: credential,
      username: gitLabOAuth ? 'oauth2' : account.login || 'oauth2',
      token,
    };
  }

  private async resolveAccount(
    target: GitCredentialSessionTarget,
    requestHost: string,
    providerId: 'github' | 'gitlab'
  ): Promise<ProviderAccountSummary | null> {
    if (target.kind === 'account') {
      if (normalizeRepositoryHost(target.host) !== requestHost) return null;
      const account = (await this.deps.listAccounts(providerId)).find(
        (candidate) =>
          candidate.accountId === target.accountId && candidate.providerId === providerId
      );
      return account && account.host && normalizeRepositoryHost(account.host) === requestHost
        ? account
        : null;
    }

    const resolution = await this.deps.resolveProjectIntegrationAccount(
      target.projectId,
      providerId,
      { kind: 'project' }
    );
    const account = resolution.value;
    if (!account || account.providerId !== providerId || !account.host) return null;
    if (providerId === 'github' && !isGitHubAccountSummary(account)) return null;
    // The helper config is scoped to the account's host; still verify, since
    // the session env could be replayed against other hosts.
    if (normalizeRepositoryHost(account.host) !== requestHost) return null;
    return account;
  }
}

function sameProjectTarget(
  current: GitCredentialSessionTarget,
  target: GitCredentialProjectTarget
): boolean {
  return (
    current.kind === 'project' &&
    current.projectId === target.projectId &&
    current.providerId === target.providerId
  );
}
