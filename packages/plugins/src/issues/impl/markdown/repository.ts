import { err, ok, type Result } from '@emdash/shared';
import type { IntegrationError } from '../../../integrations/types';
import type { BriefFile } from './brief';
import { compileGlob, normalizePath } from './glob';

/**
 * Reads task files out of a git repository, from a ref when one resolves and
 * from the working tree otherwise. Every filesystem and git call arrives as a
 * dependency so the read paths are testable with a stub.
 */

export type GitOutput = { status: 'ok'; stdout: string } | { status: 'failed'; message: string };

export type DirectoryEntry = { name: string; isDirectory: boolean };

export type BriefReaderDependencies = {
  /** Runs `git <args>` with `repositoryPath` as the working directory. */
  git(repositoryPath: string, args: readonly string[]): Promise<GitOutput>;
  readFile(absolutePath: string): Promise<string>;
  readDirectory(absolutePath: string): Promise<DirectoryEntry[]>;
  /** ISO-8601 mtime, or undefined when it cannot be read. */
  modifiedAt(absolutePath: string): Promise<string | undefined>;
};

export type ReadBriefsInput = {
  repositoryPath: string;
  pattern: string;
  /** Empty or unresolvable falls back to the working tree. */
  trunkRef?: string;
};

export type BriefReadResult = {
  files: BriefFile[];
  /** Which tree the files came from; surfaced in logs and tests. */
  source: 'ref' | 'working-tree';
  /** The resolved ref, when `source` is `ref`. */
  ref?: string;
};

/** Enough headroom for a large repository without unbounded subprocess fan-out. */
const MAX_BRIEF_FILES = 500;
const READ_CONCURRENCY = 8;
const MAX_WALK_DEPTH = 12;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
/** Record separator between `git log` entries; never legal in a commit date. */
const LOG_RECORD_MARK = '\u0001';

export async function readBriefs(
  dependencies: BriefReaderDependencies,
  input: ReadBriefsInput
): Promise<Result<BriefReadResult, IntegrationError>> {
  let glob;
  try {
    glob = compileGlob(input.pattern);
  } catch (error) {
    return err({
      type: 'invalid_input',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const repositoryPath = trimTrailingSlash(input.repositoryPath);
  if (!repositoryPath) {
    return err({ type: 'invalid_input', message: 'No repository is open for this project.' });
  }

  const ref = await resolveRef(dependencies, repositoryPath, input.trunkRef);
  const paths = ref
    ? await listPathsFromRef(dependencies, repositoryPath, ref, glob)
    : await listPathsFromWorkingTree(dependencies, repositoryPath, glob);
  if (!paths.success) return paths;

  const selected = paths.data.slice(0, MAX_BRIEF_FILES);
  const updatedAt = ref
    ? await readCommitDates(dependencies, repositoryPath, ref, glob.literalPrefix)
    : new Map<string, string>();

  const files = await mapWithConcurrency(selected, READ_CONCURRENCY, async (path) => {
    const text = ref
      ? await readFromRef(dependencies, repositoryPath, ref, path)
      : await readFromWorkingTree(dependencies, repositoryPath, path);
    if (text === undefined) return undefined;
    const timestamp =
      updatedAt.get(path) ??
      (ref ? undefined : await dependencies.modifiedAt(`${repositoryPath}/${path}`));
    return {
      path,
      repositoryPath,
      text,
      ...(timestamp !== undefined && { updatedAt: timestamp }),
    } satisfies BriefFile;
  });

  return ok({
    files: files.filter((file): file is BriefFile => file !== undefined),
    source: ref ? 'ref' : 'working-tree',
    ...(ref !== undefined && { ref }),
  });
}

/**
 * The ref the files are read from, or undefined to read the working tree. An
 * unresolvable ref (a fresh clone with no `origin/HEAD`, a detached mirror)
 * degrades to the working tree rather than showing nothing.
 */
async function resolveRef(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  trunkRef: string | undefined
): Promise<string | undefined> {
  const ref = trunkRef?.trim();
  if (!ref) return undefined;
  const result = await dependencies.git(repositoryPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ]);
  return result.status === 'ok' && result.stdout.trim() ? ref : undefined;
}

async function listPathsFromRef(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  ref: string,
  glob: ReturnType<typeof compileGlob>
): Promise<Result<string[], IntegrationError>> {
  const result = await dependencies.git(repositoryPath, [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    ref,
    '--',
    glob.literalPrefix || '.',
  ]);
  if (result.status === 'failed') {
    return err({
      type: 'not_found_or_no_access',
      message: `Unable to list task files in "${ref}": ${result.message}`,
    });
  }
  const paths = result.stdout
    .split('\0')
    .map((path) => normalizePath(path))
    .filter((path) => path.length > 0 && glob.matches(path));
  return ok(paths.sort());
}

async function listPathsFromWorkingTree(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  glob: ReturnType<typeof compileGlob>
): Promise<Result<string[], IntegrationError>> {
  const found: string[] = [];

  async function walk(relative: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || found.length >= MAX_BRIEF_FILES) return;
    const absolute = relative ? `${repositoryPath}/${relative}` : repositoryPath;
    let entries: DirectoryEntry[];
    try {
      entries = await dependencies.readDirectory(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(path, depth + 1);
        continue;
      }
      if (glob.matches(path)) found.push(path);
    }
  }

  await walk(glob.literalPrefix, 0);
  return ok(found.sort());
}

/**
 * Last commit date per path in one `git log` pass. Walking the history once
 * beats a `git log` per file, which is what makes a few hundred task files
 * affordable.
 */
async function readCommitDates(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  ref: string,
  literalPrefix: string
): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  const result = await dependencies.git(repositoryPath, [
    '-c',
    'core.quotePath=false',
    'log',
    `--pretty=format:${LOG_RECORD_MARK}%cI`,
    '--name-only',
    '--no-renames',
    '-n',
    String(MAX_BRIEF_FILES),
    ref,
    '--',
    literalPrefix || '.',
  ]);
  if (result.status === 'failed') return dates;

  let current: string | undefined;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith(LOG_RECORD_MARK)) {
      current = line.slice(LOG_RECORD_MARK.length).trim();
      continue;
    }
    const path = normalizePath(line.trim());
    if (!path || !current || dates.has(path)) continue;
    dates.set(path, current);
  }
  return dates;
}

async function readFromRef(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  ref: string,
  path: string
): Promise<string | undefined> {
  const result = await dependencies.git(repositoryPath, ['show', `${ref}:${path}`]);
  return result.status === 'ok' ? result.stdout : undefined;
}

async function readFromWorkingTree(
  dependencies: BriefReaderDependencies,
  repositoryPath: string,
  path: string
): Promise<string | undefined> {
  try {
    return await dependencies.readFile(`${repositoryPath}/${path}`);
  } catch {
    return undefined;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/[/\\]+$/u, '');
}
