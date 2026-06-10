import * as https from 'node:https';
import type { ReleaseSource } from '@emdash/cli-agent-plugins';
import { log } from '@main/lib/logger';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  version: string | null;
  expiresAt: number;
}

function httpsGet(url: string, options: { redirectCount?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectCount = options.redirectCount ?? 0;
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'emdash-latest-version',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            const resolved = new URL(location, url).href;
            httpsGet(resolved, { redirectCount: redirectCount + 1 }).then(resolve, reject);
            return;
          }
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        let bytes = 0;
        let destroyed = false;
        res.on('data', (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) {
            destroyed = true;
            req.destroy(new Error(`Response too large for ${url}`));
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          if (!destroyed) resolve(data);
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

export class LatestVersionService {
  private cache = new Map<string, CacheEntry>();

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
      log.debug(`[latest-version] failed to fetch ${cacheKey}: ${(err as Error).message}`);
      return null;
    }
  }

  private async resolve(source: ReleaseSource): Promise<string | null> {
    if (source.kind === 'npm') {
      const url = `https://registry.npmjs.org/${encodeURIComponent(source.package)}/latest`;
      const body = await httpsGet(url);
      const json = JSON.parse(body) as { version?: string };
      return json.version ?? null;
    }

    if (source.kind === 'github') {
      const url = `https://api.github.com/repos/${source.repo}/releases/latest`;
      const body = await httpsGet(url);
      const json = JSON.parse(body) as { tag_name?: string };
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
