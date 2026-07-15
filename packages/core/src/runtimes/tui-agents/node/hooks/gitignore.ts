import type { PluginFs } from '@primitives/plugin-fs/api';

const GITIGNORE_PATH = '.gitignore';

export async function ensureGitIgnoreEntries(fs: PluginFs, entries: string[]): Promise<void> {
  const existing = (await fs.read(GITIGNORE_PATH)) ?? '';
  const existingLines = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const isIgnored = (entry: string) => {
    const norm = entry.replace(/^\/+/, '');
    return existingLines.some((raw) => {
      const path = raw.replace(/^\/+/, '');
      if (path === norm) return true;
      if (path.endsWith('/')) return norm.startsWith(path);
      if (path.endsWith('/**')) return norm.startsWith(path.slice(0, -2));
      return false;
    });
  };

  const missing = entries.filter((entry) => !isIgnored(entry));
  if (missing.length === 0) return;

  const content = existing.replace(/\s*$/, '');
  const next =
    content.length > 0 ? `${content}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
  await fs.write(GITIGNORE_PATH, next);
}
