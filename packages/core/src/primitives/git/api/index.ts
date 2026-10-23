import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Pure Git discovery policy shared by host runtimes. Call only for the initial
 * discovery command, with Git's diagnostic locale fixed to C.
 *
 * Exit 128 also covers broken gitfiles, configuration, ownership and permissions.
 * Only Git's specific discovery-miss diagnostics prove the absence of a repository.
 */
export function isGitDiscoveryMiss(failure: { exitCode: number | null; stderr: string }): boolean {
  if (failure.exitCode !== 128) return false;
  const diagnostic = failure.stderr.trim();
  return (
    diagnostic === 'fatal: not a git repository (or any of the parent directories): .git' ||
    /^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.$/.test(
      diagnostic
    )
  );
}

/**
 * Checks whether a given path points to a Windows Subsystem for Linux (WSL) UNC share
 * (e.g. `\\wsl.localhost\Ubuntu\...` or `\\wsl$\Ubuntu\...`).
 */
export function isWslPath(targetPath: string): boolean {
  return /^[/\\]{2}wsl(?:\.localhost|\$)?(?:[/\\]|$)/i.test(targetPath.trim());
}

/**
 * Normalizes a path for use as a Git safe.directory value:
 * strips trailing slashes/backslashes which cause Git's prefix matcher to fail.
 */
export function normalizeSafeGitDirectoryPath(targetPath: string): string {
  return targetPath.trim().replace(/[/\\]+$/, '');
}

function defaultFileExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Traverses parent directories of a WSL path to locate the enclosing Git repository root.
 * Returns the repository root if found, or null if no enclosing Git repository is found.
 */
export function findWslRepositoryRoot(
  targetPath: string,
  fileExists: (filePath: string) => boolean = defaultFileExists
): string | null {
  if (!isWslPath(targetPath)) return null;

  let current = normalizeSafeGitDirectoryPath(targetPath);
  if (!current) return null;

  // If path ends in .git, start from its parent directory
  if (/[/\\]\.git$/i.test(current)) {
    current = current.replace(/[/\\]\.git$/i, '');
    if (!current || !isWslPath(current)) return null;
  }

  while (isWslPath(current)) {
    const gitDirSlash = `${current}/.git`.replace(/\\/g, '/');
    const gitDirBackslash = current.includes('\\') ? `${current}\\.git` : gitDirSlash;
    if (fileExists(gitDirSlash) || fileExists(gitDirBackslash)) {
      return current;
    }

    const lastSlash = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
    if (lastSlash <= 2) break;
    const parent = current.slice(0, lastSlash);
    if (parent === current || !isWslPath(parent)) break;
    current = parent;
  }

  return null;
}

function resolveWorktreeCommonRepo(
  worktreeRoot: string,
  fileExists: (filePath: string) => boolean
): string | null {
  try {
    const gitDirSlash = `${worktreeRoot}/.git`.replace(/\\/g, '/');
    const gitDirBackslash = worktreeRoot.includes('\\') ? `${worktreeRoot}\\.git` : gitDirSlash;
    const gitPath = fileExists(gitDirBackslash) ? gitDirBackslash : gitDirSlash;

    const stat = statSync(gitPath);
    if (!stat.isFile()) return null;
    const content = readFileSync(gitPath, 'utf8');
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    let gitDir = match[1].trim();

    if (!path.isAbsolute(gitDir) && !gitDir.startsWith('/') && !gitDir.startsWith('\\')) {
      gitDir = path.resolve(worktreeRoot, gitDir);
    } else if (gitDir.startsWith('/') && !/^[/\\]{2}/.test(gitDir)) {
      const shareMatch = worktreeRoot.match(/^([/\\]{2}wsl(?:\.localhost|\$)?[/\\][^/\\]+)/i);
      if (shareMatch) {
        gitDir = `${shareMatch[1]}${gitDir}`.replace(/\//g, '\\');
      }
    }

    const gitDirIdx = gitDir.toLowerCase().lastIndexOf('.git');
    if (gitDirIdx !== -1) {
      const mainRepo = gitDir.slice(0, gitDirIdx).replace(/[/\\]+$/, '');
      if (mainRepo && isWslPath(mainRepo)) {
        return mainRepo;
      }
    }
  } catch {
    // Ignore errors reading gitdir
  }
  return null;
}

/**
 * Augments an execution environment for Git commands so that cross-boundary WSL
 * repositories (`\\wsl.localhost\...` or `\\wsl$\...`) accessed on Windows are not
 * rejected by Git's safe.directory ownership check (dubious ownership).
 *
 * Scoped strictly to the intended WSL repository path to prevent trusting foreign-owned
 * repositories elsewhere on the system (mitigating CVE-2022-24765). Composes cleanly with
 * existing GIT_CONFIG_* variables (e.g. credential helpers) without replacing them.
 */
export function withSafeGitDirectoryEnv(
  env: NodeJS.ProcessEnv,
  targetPaths?: string | readonly (string | undefined)[],
  platform: NodeJS.Platform = process.platform,
  fileExists: (filePath: string) => boolean = defaultFileExists
): NodeJS.ProcessEnv {
  if (platform !== 'win32' || !targetPaths) {
    return env;
  }

  const rawPaths = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
  const candidates = new Set<string>();

  for (const rawPath of rawPaths) {
    if (!rawPath || typeof rawPath !== 'string' || !isWslPath(rawPath)) {
      continue;
    }
    const primaryPath = normalizeSafeGitDirectoryPath(rawPath);
    if (!primaryPath) continue;

    candidates.add(primaryPath);
    const forwardSlashPath = primaryPath.replace(/\\/g, '/');
    candidates.add(forwardSlashPath);

    // Resolve enclosing repository root (e.g. when opening a subdirectory of a WSL repository)
    const enclosingRepo = findWslRepositoryRoot(primaryPath, fileExists);
    if (enclosingRepo) {
      const normalizedEnclosing = normalizeSafeGitDirectoryPath(enclosingRepo);
      candidates.add(normalizedEnclosing);
      candidates.add(normalizedEnclosing.replace(/\\/g, '/'));

      const commonRepo = resolveWorktreeCommonRepo(normalizedEnclosing, fileExists);
      if (commonRepo) {
        const normalizedCommon = normalizeSafeGitDirectoryPath(commonRepo);
        candidates.add(normalizedCommon);
        candidates.add(normalizedCommon.replace(/\\/g, '/'));
      }
    }

    // If pointing to a .git directory, also trust the enclosing repository root
    if (/[/\\]\.git$/i.test(primaryPath)) {
      const parent = primaryPath.slice(0, -4).replace(/[/\\]+$/, '');
      if (parent && isWslPath(parent)) {
        candidates.add(parent);
        candidates.add(parent.replace(/\\/g, '/'));
      }
    }
  }

  if (candidates.size === 0) {
    return env;
  }

  // Inspect existing indexed GIT_CONFIG entries
  const existingCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const count = Number.isInteger(existingCount) && existingCount >= 0 ? existingCount : 0;

  const existingSafeDirs = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    if (env[`GIT_CONFIG_KEY_${i}`]?.toLowerCase() === 'safe.directory') {
      const val = env[`GIT_CONFIG_VALUE_${i}`];
      if (val) {
        if (val === '*') return env;
        existingSafeDirs.add(val);
      }
    }
  }

  const pathsToAdd = [...candidates].filter((p) => !existingSafeDirs.has(p));
  if (pathsToAdd.length === 0) {
    return env;
  }

  const nextEnv: NodeJS.ProcessEnv = { ...env };
  let nextIndex = count;
  for (const pathToAdd of pathsToAdd) {
    nextEnv[`GIT_CONFIG_KEY_${nextIndex}`] = 'safe.directory';
    nextEnv[`GIT_CONFIG_VALUE_${nextIndex}`] = pathToAdd;
    nextIndex += 1;
  }
  nextEnv.GIT_CONFIG_COUNT = String(nextIndex);

  return nextEnv;
}
