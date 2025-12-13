// Helpers for extracting @mentions and assembling attachment blocks

export function extractMentions(text: string): string[] {
  const re = /@[\w\-.\/]+/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[0].slice(1);
    if (token) set.add(token);
  }
  return Array.from(set);
}

export function getFenceLang(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'ts') return 'ts';
  if (ext === 'js') return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'md';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  if (ext === 'html') return 'html';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'bash';
  return '';
}

export function stripMentions(text: string): string {
  if (!text) return '';
  const re = /@[\w\-.\/]+/g;
  return text
    .replace(re, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function buildAttachmentsSection(
  rootPath: string,
  text: string,
  opts?: { maxFiles?: number; maxBytesPerFile?: number }
): Promise<string> {
  const mentions = extractMentions(text);
  const MAX_FILES = Math.max(1, Math.min(opts?.maxFiles ?? 6, 20));
  const MAX_BYTES_PER_FILE = Math.max(
    1024,
    Math.min(opts?.maxBytesPerFile ?? 200 * 1024, 5 * 1024 * 1024)
  );
  const limited = mentions.slice(0, MAX_FILES);

  const parts: string[] = [];
  for (const rel of limited) {
    try {
      const res = await window.electronAPI.fsRead(rootPath, rel, MAX_BYTES_PER_FILE);
      if (res.success && typeof res.content === 'string') {
        const lang = getFenceLang(rel);
        const header = `File: ${rel}${res.truncated ? ` (truncated to ${MAX_BYTES_PER_FILE} bytes)` : ''}`;
        parts.push(`${header}\n\n\`\`\`${lang}\n${res.content}\n\`\`\``);
      }
    } catch {
      // Ignore unreadable files
    }
  }

  if (parts.length === 0) return '';
  return `\n\n---\nAttached files (from workspace):\n\n${parts.join('\n\n')}\n`;
}

export function buildImageAttachmentsSection(taskPath: string, relPaths: string[]): string {
  if (!relPaths || relPaths.length === 0) return '';
  const lines: string[] = [];
  for (const rel of relPaths) {
    const name = rel.split(/[\\/]/).pop() || 'image';
    const sep = taskPath.endsWith('/') ? '' : '/';
    const absPath = (taskPath + sep + rel).replace(/\\/g, '/');
    // Markdown image referencing a file URL; many CLIs that support images accept this pattern
    const url = `file://${absPath}`;
    lines.push(`![${name}](${url})`);
  }
  return `\n\n---\nAttached images (from workspace):\n\n${lines.join('\n')}\n`;
}
