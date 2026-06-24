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

export function isIgnored(relPath: string): boolean {
  if (!relPath) return false;
  return relPath.split('/').some((segment) => IGNORED_PATH_SEGMENT_SET.has(segment));
}

export function watchIgnoreGlobs(): string[] {
  return IGNORED_PATH_SEGMENTS.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}
