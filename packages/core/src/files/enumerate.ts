import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isIgnoredInsideRoot } from './ignores';
import { validateAbsolutePath } from './paths';

export async function* enumerate(rootPath: string): AsyncIterable<string> {
  const validated = validateAbsolutePath(rootPath);
  if (!validated.success) return;
  yield* enumerateDirectory(validated.data, validated.data);
}

async function* enumerateDirectory(rootPath: string, dirPath: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (isIgnoredInsideRoot(rootPath, absPath)) continue;

    if (entry.isFile()) {
      yield absPath;
      continue;
    }
    if (entry.isDirectory()) {
      yield* enumerateDirectory(rootPath, absPath);
    }
  }
}
