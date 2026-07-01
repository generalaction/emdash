import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { includeAllFiles, type FileExclusionPredicate } from './exclusions';
import { validateAbsolutePath } from './paths';

export type FileEnumerationOptions = {
  exclude?: FileExclusionPredicate;
  includeSymlinkFiles?: boolean;
};

export async function* enumerate(
  rootPath: string,
  options: FileEnumerationOptions = {}
): AsyncIterable<string> {
  const validated = validateAbsolutePath(rootPath);
  if (!validated.success) return;
  yield* enumerateDirectory(validated.data, {
    exclude: options.exclude ?? includeAllFiles,
    includeSymlinkFiles: options.includeSymlinkFiles ?? true,
  });
}

type EnumerationState = {
  exclude: FileExclusionPredicate;
  includeSymlinkFiles: boolean;
};

async function* enumerateDirectory(
  dirPath: string,
  state: EnumerationState
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
    if (state.exclude(absPath)) continue;

    if (entry.isFile()) {
      yield absPath;
      continue;
    }
    if (entry.isDirectory()) {
      yield* enumerateDirectory(absPath, state);
      continue;
    }
    if (entry.isSymbolicLink()) {
      if (state.includeSymlinkFiles && (await statTargetType(absPath)) === 'file') {
        yield absPath;
      }
    }
  }
}

async function statTargetType(
  absPath: string
): Promise<'file' | 'directory' | 'other' | 'missing'> {
  try {
    const target = await stat(absPath);
    if (target.isFile()) return 'file';
    if (target.isDirectory()) return 'directory';
    return 'other';
  } catch {
    return 'missing';
  }
}
