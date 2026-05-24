import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import { extractGhCliToken } from './gh-cli-token';

const TOKEN_TTL_MS = 2 * 60 * 1000;

type TokenCacheEntry = {
  token: string | null;
  expiresAt: number;
};

export class GhCliGitHubEnterpriseAuthSource {
  private readonly cache = new Map<string, TokenCacheEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly ctxFactory: () => IExecutionContext = () => new LocalExecutionContext()
  ) {}

  async getToken(host: string): Promise<string | null> {
    const normalizedHost = normalizeRepositoryHost(host);
    const cached = this.cache.get(normalizedHost);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const existing = this.inflight.get(normalizedHost);
    if (existing) return existing;

    const promise = this.fetchToken(normalizedHost).finally(() => {
      this.inflight.delete(normalizedHost);
    });
    this.inflight.set(normalizedHost, promise);
    return promise;
  }

  clear(host?: string): void {
    if (host) {
      this.cache.delete(normalizeRepositoryHost(host));
      return;
    }
    this.cache.clear();
  }

  private async fetchToken(host: string): Promise<string | null> {
    const ctx = this.ctxFactory();
    const token = await extractGhCliToken(ctx, { hostname: host });
    if (token) {
      this.cache.set(host, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    }
    return token;
  }
}

export const ghCliGitHubEnterpriseAuthSource = new GhCliGitHubEnterpriseAuthSource();
