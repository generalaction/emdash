import { readdir } from 'node:fs/promises';
import { isIgnored } from './ignores';
import { normalizeRelPath, resolveInsideRoot, type RelPath } from './paths';

export async function* enumerate(rootPath: string): AsyncIterable<RelPath> {
  yield* enumerateDirectory(rootPath, '');
}

async function* enumerateDirectory(rootPath: string, dirPath: string): AsyncIterable<RelPath> {
  const resolved = resolveInsideRoot(rootPath, dirPath, { allowEmpty: true });
  if (!resolved.success) return;

  let entries;
  try {
    entries = await readdir(resolved.data.absPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relPath = resolved.data.relPath ? `${resolved.data.relPath}/${entry.name}` : entry.name;
    const normalized = normalizeRelPath(relPath);
    if (!normalized.success || isIgnored(normalized.data)) continue;

    if (entry.isFile()) {
      yield normalized.data;
      continue;
    }
    if (entry.isDirectory()) {
      yield* enumerateDirectory(rootPath, normalized.data);
    }
  }
}
