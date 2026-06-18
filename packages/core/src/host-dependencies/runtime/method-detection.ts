import type { IExecutionContext } from '../../exec/execution-context';
import type { Platform } from '../capability';
import { inferMethod } from './location-hints';
import type { Provenance } from './types';

const DETECT_TIMEOUT_MS = 5_000;

async function queryDir(
  ctx: IExecutionContext,
  command: string,
  args: string[]
): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec(command, args, { timeout: DETECT_TIMEOUT_MS });
    return stdout.trim().split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

export type InstallMethodDetector = {
  /** Detect the provenance of a binary at the given realpath. Never throws. */
  detect(realPath: string): Promise<Provenance>;
  /**
   * Invalidate cached package-manager root queries so the next detect() call
   * re-queries. Call after install/uninstall to pick up changes.
   */
  invalidate(): void;
};

/**
 * Creates a per-host install provenance detector that queries brew and npm for their
 * root/prefix directories, then uses those roots to definitively classify a binary's
 * realpath before falling back to path-substring heuristics.
 *
 * Returns a full Provenance object (kind + confidence + optional managerRef) instead
 * of just an InstallMethod. 'confirmed' confidence means a package-manager query
 * confirmed ownership; 'inferred' means path-substring heuristics only.
 *
 * Detection order:
 *   1. realpath under `brew --cellar`    → homebrew, confirmed, managerRef = formula
 *   2. realpath under Caskroom paths     → homebrew, confirmed, managerRef = cask
 *   3. realpath under `brew --prefix`/opt → homebrew, confirmed (formula opt-prefix)
 *   4. realpath under `npm root -g`      → npm, confirmed
 *   5. fallback to inferMethod(realPath, platform) heuristics → inferred
 *   6. unknown if no heuristic matches   → unknown, inferred
 *
 * Cache strategy: the brew/npm root queries are memoized per detector lifetime
 * but a failed (null) result is NOT permanently cached — it is marked as a
 * transient failure so `invalidate()` can clear it and allow a retry.
 */
export function createInstallMethodDetector(
  ctx: IExecutionContext,
  platform: Platform
): InstallMethodDetector {
  // undefined = not yet fetched; null = confirmed absent/failed; string = valid path
  let brewCellarCache: string | null | undefined;
  let brewPrefixCache: string | null | undefined;
  let npmRootCache: string | null | undefined;

  // Track whether each cache entry was a confirmed failure (never retry) or a
  // transient failure (retry after invalidate). A non-null string is always kept.
  let brewCellarFailed = false;
  let brewPrefixFailed = false;
  let npmRootFailed = false;

  async function brewCellar(): Promise<string | null> {
    if (brewCellarCache !== undefined && !brewCellarFailed) return brewCellarCache;
    if (brewCellarFailed) return null;
    const result = platform !== 'windows' ? await queryDir(ctx, 'brew', ['--cellar']) : null;
    if (result) {
      brewCellarCache = result;
    } else {
      brewCellarFailed = false; // transient — allow retry after invalidate
      brewCellarCache = null;
    }
    return brewCellarCache;
  }

  async function brewPrefix(): Promise<string | null> {
    if (brewPrefixCache !== undefined && !brewPrefixFailed) return brewPrefixCache;
    if (brewPrefixFailed) return null;
    const result = platform !== 'windows' ? await queryDir(ctx, 'brew', ['--prefix']) : null;
    if (result) {
      brewPrefixCache = result;
    } else {
      brewPrefixFailed = false;
      brewPrefixCache = null;
    }
    return brewPrefixCache;
  }

  async function npmRoot(): Promise<string | null> {
    if (npmRootCache !== undefined && !npmRootFailed) return npmRootCache;
    if (npmRootFailed) return null;
    const result = await queryDir(ctx, 'npm', ['root', '-g']);
    if (result) {
      npmRootCache = result;
    } else {
      npmRootFailed = false;
      npmRootCache = null;
    }
    return npmRootCache;
  }

  function normalizeDir(dir: string): string {
    return dir.toLowerCase().replace(/\/+$/, '');
  }

  function pathStartsWith(lower: string, dir: string): boolean {
    const norm = normalizeDir(dir);
    return lower.startsWith(norm + '/') || lower === norm;
  }

  /** Extract a segment of a path that follows a known prefix directory. */
  function extractSegmentAfterPrefix(realPath: string, prefix: string): string | undefined {
    const norm = normalizeDir(prefix);
    const lower = realPath.toLowerCase();
    if (!pathStartsWith(lower, norm)) return undefined;
    // Get the actual casing from the original realPath
    const rest = realPath.slice(norm.length).replace(/^\/+/, '');
    // First path segment = formula/cask name
    return rest.split('/')[0] ?? undefined;
  }

  return {
    async detect(realPath: string): Promise<Provenance> {
      const lower = realPath.toLowerCase();

      // 1. Homebrew Cellar (formulas)
      const cellar = await brewCellar();
      if (cellar && pathStartsWith(lower, cellar)) {
        const managerRef = extractSegmentAfterPrefix(realPath, cellar);
        return { kind: 'homebrew', confidence: 'confirmed', managerRef };
      }

      // 2. Homebrew Caskroom paths — check prefix/Caskroom and prefix/opt
      const prefix = await brewPrefix();
      if (prefix) {
        const caskroom = prefix + '/Caskroom';
        if (pathStartsWith(lower, caskroom)) {
          const managerRef = extractSegmentAfterPrefix(realPath, caskroom);
          return { kind: 'homebrew', confidence: 'confirmed', managerRef };
        }
        const opt = prefix + '/opt';
        if (pathStartsWith(lower, opt)) {
          const managerRef = extractSegmentAfterPrefix(realPath, opt);
          return { kind: 'homebrew', confidence: 'confirmed', managerRef };
        }
      }

      // 3. npm global root
      const root = await npmRoot();
      if (root && pathStartsWith(lower, root)) {
        // managerRef: parent dir of node_modules is the package root; use descriptor later
        return { kind: 'npm', confidence: 'confirmed' };
      }

      // 4. Fallback to path-substring heuristics
      const inferred = inferMethod(realPath, platform);
      if (inferred !== null) {
        return { kind: inferred, confidence: 'inferred' };
      }

      // Version-manager shim detection (mise, asdf, nvm shims)
      if (
        lower.includes('/.asdf/shims/') ||
        lower.includes('/mise/shims/') ||
        lower.includes('/.rtx/shims/')
      ) {
        return { kind: 'version-manager', confidence: 'inferred' };
      }

      return { kind: 'unknown', confidence: 'inferred' };
    },

    invalidate(): void {
      brewCellarCache = undefined;
      brewCellarFailed = false;
      brewPrefixCache = undefined;
      brewPrefixFailed = false;
      npmRootCache = undefined;
      npmRootFailed = false;
    },
  };
}
