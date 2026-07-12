import path from 'node:path';
import type { FileExclusionPredicate } from '@main/core/files/runtime-process/client';

export const SEARCH_INDEX_EXCLUDED_PATH_SEGMENTS = [
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
  '.vscode-test',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  '.checkouts',
  'checkouts',
  '.conductor',
  '.cursor',
  '.claude',
  '.devin',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
  'worktrees',
  '.worktrees',
  '.emdash',
  'node_modules',
] as const;

const SEARCH_INDEX_EXCLUDED_PATH_SEGMENT_SET = new Set<string>(SEARCH_INDEX_EXCLUDED_PATH_SEGMENTS);

export function createSearchIndexExclusion(rootPath: string): FileExclusionPredicate {
  return (absPath) => isSearchIndexExcludedInsideRoot(rootPath, absPath);
}

export function isSearchIndexExcludedInsideRoot(rootPath: string, absPath: string): boolean {
  const relativeToRoot = path.relative(rootPath, absPath);
  if (
    !relativeToRoot ||
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot.startsWith('../') ||
    path.isAbsolute(relativeToRoot)
  ) {
    return false;
  }
  return relativeToRoot
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => SEARCH_INDEX_EXCLUDED_PATH_SEGMENT_SET.has(segment));
}
