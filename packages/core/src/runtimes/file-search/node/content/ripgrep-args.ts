import path from 'node:path';
import { CONTENT_SEARCH_MAX_LINE_LENGTH } from '@runtimes/file-search/api';
import { DefaultFileSearchExclusions, type FileSearchExclusions } from '../exclusions';
import type { ResolvedContentSearchInput } from './content-searcher';

const DEFAULT_EXCLUSIONS = new DefaultFileSearchExclusions();

export function createRipgrepContentSearchArgs(
  input: ResolvedContentSearchInput,
  exclusions: FileSearchExclusions = DEFAULT_EXCLUSIONS
): string[] {
  const args = [
    '--json',
    '--fixed-strings',
    '--ignore-case',
    '--no-follow',
    '--color=never',
    `--max-columns=${CONTENT_SEARCH_MAX_LINE_LENGTH}`,
  ];
  const globFlag = process.platform === 'win32' ? '--iglob' : '--glob';

  for (const glob of exclusions.ripgrepGlobs()) args.push(globFlag, glob);

  const relativeSearchPath = path.relative(input.rootPath, input.searchPath);
  if (
    relativeSearchPath === '..' ||
    relativeSearchPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSearchPath)
  ) {
    throw new Error('Resolved content-search path is outside the registered root');
  }
  args.push('--', input.query, relativeSearchPath || '.');
  return args;
}
