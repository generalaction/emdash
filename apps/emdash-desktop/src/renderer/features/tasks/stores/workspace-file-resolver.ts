/**
 * WorkspaceFileResolver — desktop-side enrichment cache for ACP resource links
 * and inline markdown link classification.
 *
 * Design:
 *   - Keyed by normalized path (not the full URI) to coalesce duplicate checks.
 *   - States: pending (in-flight RPC) / valid (file exists) / invalid (does not exist).
 *   - Invalid entries have a short TTL so that files created mid-turn can be
 *     re-validated on `turn_done`.
 *   - Bounded to MAX_ENTRIES to prevent unbounded growth during long sessions.
 *   - `classifyLink` is synchronous (cache hit only) and safe to call at render time.
 *   - `resolve` is async and always resolves; it coalesces in-flight calls per path.
 *   - `clear` removes all state; call on unmount / session change.
 *
 * URI handling (sync prefilter):
 *   - http(s):// → external (never needs an RPC call)
 *   - file:///   → extract path component → workspace file candidate
 *   - relative   → treat as workspace-relative path candidate
 *   - other      → opaque (custom MCP scheme)
 */

import type { ResourceTarget } from '@emdash/chat-ui';
import { rpc } from '@renderer/lib/ipc';

// ── Constants ────────────────────────────────────────────────────────────────

const NEGATIVE_TTL_MS = 30_000;
const MAX_ENTRIES = 500;

// ── Internal state ────────────────────────────────────────────────────────────

type CacheEntry =
  | { state: 'pending'; promise: Promise<boolean> }
  | { state: 'valid' }
  | { state: 'invalid'; expiresAt: number };

// ── URI prefilter ─────────────────────────────────────────────────────────────

type UriKind =
  | { kind: 'workspace-candidate'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'opaque' };

function classifyUri(uri: string): UriKind {
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return { kind: 'external', url: uri };
  }
  if (uri.startsWith('file:///')) {
    // file:///absolute/path → /absolute/path
    try {
      const path = new URL(uri).pathname;
      return { kind: 'workspace-candidate', path };
    } catch {
      return { kind: 'opaque' };
    }
  }
  // No scheme or a relative path — treat as workspace-relative candidate.
  if (!uri.includes('://')) {
    return { kind: 'workspace-candidate', path: uri };
  }
  // Custom scheme (e.g. mcp://, claude://)
  return { kind: 'opaque' };
}

// ── Public types ──────────────────────────────────────────────────────────────

export type WorkspaceFileResolver = {
  /**
   * Synchronously classify an `href` for render-time link styling.
   *
   * Returns `{ kind: 'workspace-file', path }` only when a prior async resolve()
   * confirmed the path exists. Falls back to `{ kind: 'external' }` for all
   * unresolved / unknown / external hrefs.
   *
   * Safe to call at render time — no RPC, no side effects.
   */
  classifyLink(href: string): { kind: 'workspace-file'; path: string } | { kind: 'external' };

  /**
   * Asynchronously resolve a URI from an ACP `resource_link` content block to
   * a `ResourceTarget` suitable for the chat-ui model.
   *
   * Coalesces simultaneous calls for the same path into a single RPC request.
   */
  resolve(uri: string): Promise<ResourceTarget>;

  /**
   * Evict and re-check all currently-invalid entries whose TTL has expired.
   * Call this on `turn_done` to pick up files created mid-turn.
   */
  reEnrichStale(): Promise<void>;

  /**
   * Remove all cached state.  Call on session teardown or workspace change.
   */
  clear(): void;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createWorkspaceFileResolver(
  projectId: string,
  workspaceId: string
): WorkspaceFileResolver {
  const cache = new Map<string, CacheEntry>();

  const checkPath = (path: string): Promise<boolean> => {
    const existing = cache.get(path);

    if (existing?.state === 'pending') return existing.promise;
    if (existing?.state === 'valid') return Promise.resolve(true);
    if (existing?.state === 'invalid' && existing.expiresAt > Date.now()) {
      return Promise.resolve(false);
    }

    if (cache.size >= MAX_ENTRIES) {
      // Evict oldest invalid entries first, then give up if still full.
      for (const [k, v] of cache) {
        if (v.state === 'invalid') {
          cache.delete(k);
          break;
        }
      }
    }

    const promise = rpc.workspace.fs
      .fileExists(projectId, workspaceId, path)
      .then((result) => {
        const exists = result.success && result.data.exists;
        cache.set(
          path,
          exists
            ? { state: 'valid' }
            : { state: 'invalid', expiresAt: Date.now() + NEGATIVE_TTL_MS }
        );
        return exists;
      })
      .catch(() => {
        cache.set(path, {
          state: 'invalid',
          expiresAt: Date.now() + NEGATIVE_TTL_MS,
        });
        return false;
      });

    cache.set(path, { state: 'pending', promise });
    return promise;
  };

  return {
    classifyLink(href) {
      const uriKind = classifyUri(href);
      if (uriKind.kind !== 'workspace-candidate') {
        return { kind: 'external' };
      }
      const entry = cache.get(uriKind.path);
      if (entry?.state === 'valid') {
        return { kind: 'workspace-file', path: uriKind.path };
      }
      return { kind: 'external' };
    },

    async resolve(uri) {
      const uriKind = classifyUri(uri);

      if (uriKind.kind === 'external') return { kind: 'external', url: uri };
      if (uriKind.kind === 'opaque') return { kind: 'opaque' };

      const exists = await checkPath(uriKind.path);
      if (exists) return { kind: 'workspace-file', path: uriKind.path };
      // File doesn't exist (yet) — fall back to external if the URI is absolute http(s),
      // otherwise treat as opaque so the UI shows the path rather than a URL hostname.
      return { kind: 'opaque' };
    },

    async reEnrichStale() {
      const stalePaths: string[] = [];
      const now = Date.now();
      for (const [path, entry] of cache) {
        if (entry.state === 'invalid' && entry.expiresAt <= now) {
          stalePaths.push(path);
        }
      }
      await Promise.all(stalePaths.map((p) => checkPath(p)));
    },

    clear() {
      cache.clear();
    },
  };
}
