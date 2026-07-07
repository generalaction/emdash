import type { ReleaseSource } from '@emdash/core/deps';
import type { Logger } from '@emdash/core/lib';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  version: string | null;
  expiresAt: number;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'emdash-latest-version',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export class LatestVersionService {
  private cache = new Map<string, CacheEntry>();
  private logger?: Logger;

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
  }

  /**
   * Fetch the latest published version for the given release source.
   * Returns null when the source is 'none', the network is unavailable, or any
   * error occurs — callers should treat null as "unknown" and hide update UI.
   */
  async fetchLatestVersion(source: ReleaseSource): Promise<string | null> {
    if (source.kind === 'none') return null;

    const cacheKey = source.kind === 'npm' ? `npm:${source.package}` : `github:${source.repo}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.version;

    try {
      const version = await this.resolve(source);
      this.cache.set(cacheKey, { version, expiresAt: Date.now() + CACHE_TTL_MS });
      return version;
    } catch (err) {
      this.logger?.debug(`[latest-version] failed to fetch ${cacheKey}: ${(err as Error).message}`);
      return null;
    }
  }

  private async resolve(source: ReleaseSource): Promise<string | null> {
    if (source.kind === 'npm') {
      const url = `https://registry.npmjs.org/${encodeURIComponent(source.package)}/latest`;
      const json = (await fetchJson(url)) as { version?: string };
      return json.version ?? null;
    }

    if (source.kind === 'github') {
      const url = `https://api.github.com/repos/${source.repo}/releases/latest`;
      const json = (await fetchJson(url)) as { tag_name?: string };
      const tag = json.tag_name ?? null;
      return tag ? tag.replace(/^v/, '') : null;
    }

    return null;
  }

  /** Evict a specific entry (e.g. after a successful update). */
  invalidate(source: ReleaseSource): void {
    if (source.kind === 'none') return;
    const cacheKey = source.kind === 'npm' ? `npm:${source.package}` : `github:${source.repo}`;
    this.cache.delete(cacheKey);
  }
}
