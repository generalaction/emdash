import type { RuntimePath } from '@main/core/runtime/types';

export function isSafePreservePattern(machinePath: RuntimePath, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (looksAbsolute(machinePath, trimmed)) return false;
  return !trimmed.replace(/\\/g, '/').split('/').includes('..');
}

export function preservedRepoRelativePath(
  machinePath: RuntimePath,
  repoPath: string,
  absPath: string
): string | null {
  if (!machinePath.contains(repoPath, absPath)) return null;
  const relPath = machinePath.relative(repoPath, absPath).replace(/\\/g, '/');
  if (!relPath || relPath === '.emdash.json') return null;
  if (relPath === '..' || relPath.startsWith('../') || looksAbsolute(machinePath, relPath))
    return null;
  return relPath;
}

export function preservedDestinationPath(
  machinePath: RuntimePath,
  targetPath: string,
  relPath: string
): string | null {
  const destPath = machinePath.join(targetPath, relPath);
  return machinePath.contains(targetPath, destPath) ? destPath : null;
}

function looksAbsolute(machinePath: RuntimePath, value: string): boolean {
  return machinePath.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}
