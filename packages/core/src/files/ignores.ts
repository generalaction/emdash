import path from 'node:path';

export const IGNORED_PATH_SEGMENTS = [
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

const IGNORED_PATH_SEGMENT_SET = new Set<string>(IGNORED_PATH_SEGMENTS);

export function isIgnored(filePath: string): boolean {
  if (!filePath) return false;
  return isIgnoredRelativePath(filePath);
}

export function isIgnoredRelativePath(relativePath: string): boolean {
  if (!relativePath) return false;
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => IGNORED_PATH_SEGMENT_SET.has(segment));
}

export function isIgnoredInsideRoot(rootPath: string, absolutePath: string): boolean {
  if (!rootPath) return isIgnoredRelativePath(absolutePath);
  const relativeToRoot = path.relative(rootPath, absolutePath);
  if (
    !relativeToRoot ||
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot.startsWith('../') ||
    path.isAbsolute(relativeToRoot)
  ) {
    return false;
  }
  return isIgnoredRelativePath(relativeToRoot);
}

export function watchIgnoreGlobs(): string[] {
  return IGNORED_PATH_SEGMENTS.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}
