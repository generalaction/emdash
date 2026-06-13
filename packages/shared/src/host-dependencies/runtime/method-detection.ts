import type { IExecutionContext } from '../../exec/execution-context';
import type { InstallMethod, Platform } from '../capability';
import { inferMethod } from './location-hints';

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
  detect(realPath: string): Promise<InstallMethod | null>;
};

/**
 * Creates a per-host install method detector that queries brew and npm for their
 * root directories, then uses those roots to definitively classify a binary's
 * realpath before falling back to path-substring heuristics.
 *
 * Motivation: Homebrew-installed CLIs that are node packages (e.g. claude-code)
 * have realpaths containing 'node_modules' inside the Cellar. The old substring-
 * only approach matched 'node_modules' → npm before ever reaching the homebrew
 * hints, misattributing the install method.
 *
 * Detection order:
 *   1. realpath under `brew --cellar`   → 'homebrew'
 *   2. realpath under `npm root -g`     → 'npm'
 *   3. fallback to inferMethod(realPath, platform)
 *
 * Each root is queried at most once per detector lifetime (memoized). Query
 * failures (tool absent, timeout) cache as null so we fall through immediately.
 */
export function createInstallMethodDetector(
  ctx: IExecutionContext,
  platform: Platform
): InstallMethodDetector {
  // undefined = not yet fetched; null = tool absent or query failed
  let brewCellarCache: string | null | undefined;
  let npmRootCache: string | null | undefined;

  async function brewCellar(): Promise<string | null> {
    if (brewCellarCache !== undefined) return brewCellarCache;
    brewCellarCache = platform !== 'windows' ? await queryDir(ctx, 'brew', ['--cellar']) : null;
    return brewCellarCache;
  }

  async function npmRoot(): Promise<string | null> {
    if (npmRootCache !== undefined) return npmRootCache;
    npmRootCache = await queryDir(ctx, 'npm', ['root', '-g']);
    return npmRootCache;
  }

  return {
    async detect(realPath: string): Promise<InstallMethod | null> {
      const lower = realPath.toLowerCase();

      // 1. Homebrew — must be checked before npm. Homebrew formulas that package
      //    node CLIs have realpaths under the Cellar that also contain 'node_modules',
      //    so a plain substring match for 'node_modules' wrongly maps them to npm.
      const cellar = await brewCellar();
      if (cellar) {
        const cellarLower = cellar.toLowerCase().replace(/\/+$/, '');
        if (lower.startsWith(cellarLower + '/') || lower === cellarLower) {
          return 'homebrew';
        }
      }

      // 2. npm global root
      const root = await npmRoot();
      if (root) {
        const rootLower = root.toLowerCase().replace(/\/+$/, '');
        if (lower.startsWith(rootLower + '/') || lower === rootLower) {
          return 'npm';
        }
      }

      // 3. Fall back to path-substring heuristics (cargo, pip, apt, installers, etc.)
      return inferMethod(realPath, platform);
    },
  };
}
