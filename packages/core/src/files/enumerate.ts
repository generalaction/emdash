import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { includeAllFiles, type FileExclusionPredicate } from './exclusions';
import { validateAbsolutePath } from './paths';

export type FileEnumerationOptions = {
  exclude?: FileExclusionPredicate;
};

export async function* enumerate(
  rootPath: string,
  options: FileEnumerationOptions = {}
): AsyncIterable<string> {
  const validated = validateAbsolutePath(rootPath);
  if (!validated.success) return;
  yield* enumerateDirectory(validated.data, options.exclude ?? includeAllFiles);
}

async function* enumerateDirectory(
  dirPath: string,
  exclude: FileExclusionPredicate
): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (exclude(absPath)) continue;

    if (entry.isFile()) {
      yield absPath;
      continue;
    }
    if (entry.isDirectory()) {
      yield* enumerateDirectory(absPath, exclude);
    }
  }
}
