const GITIGNORE_PATH = '.gitignore';

function isGitIgnored(existingEntries: string[], entry: string): boolean {
  const normalizedEntry = entry.replace(/^\/+/, '');
  return existingEntries.some((rawPattern) => {
    const pattern = rawPattern.replace(/^\/+/, '');
    if (pattern === normalizedEntry) return true;
    if (pattern.endsWith('/')) return normalizedEntry.startsWith(pattern);
    if (pattern.endsWith('/**')) return normalizedEntry.startsWith(pattern.slice(0, -2));
    return false;
  });
}

/**
 * Append any missing entries to the project-root .gitignore (idempotent).
 * Uses the same readProjectFile/writeProjectFile callbacks as ProviderPluginDeps.
 */
export async function ensureGitIgnored(
  readProjectFile: (relPath: string) => Promise<string | undefined>,
  writeProjectFile: (relPath: string, content: string) => Promise<void>,
  entries: readonly string[]
): Promise<void> {
  if (entries.length === 0) return;

  const existing = (await readProjectFile(GITIGNORE_PATH)) ?? '';
  const existingLines = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const missing = entries.filter((entry) => !isGitIgnored(existingLines, entry));
  if (missing.length === 0) return;

  const trimmed = existing.replace(/\s*$/, '');
  const next =
    trimmed.length > 0 ? `${trimmed}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
  await writeProjectFile(GITIGNORE_PATH, next);
}
