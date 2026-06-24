export function resolveMarkdownImagePath(markdownFilePath: string, src: string): string | null {
  const cleanSrc = src.trim().replace(/\\/g, '/').split('#')[0]?.split('?')[0] ?? '';
  if (!cleanSrc) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleanSrc)) return null;
  if (cleanSrc.startsWith('//') || cleanSrc.startsWith('#')) return null;

  const fileDir = markdownFilePath.includes('/')
    ? markdownFilePath.substring(0, markdownFilePath.lastIndexOf('/'))
    : '';
  const parts = cleanSrc.startsWith('/')
    ? cleanSrc.slice(1).split('/')
    : [...(fileDir ? fileDir.split('/') : []), ...cleanSrc.split('/')];

  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return normalized.length > 0 ? normalized.join('/') : null;
}
